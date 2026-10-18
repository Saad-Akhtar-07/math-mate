"""AI marking jobs: submit, mark in the background, store the validated result.

One assessment exists per submission and pipeline version, so repeated clicks
return the same job. The job claims its row, releases the connection for the
model call, then commits the result, evidence and tutoring state together.
"""

import logging

from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..ai.prompts import prompt
from ..ai.types import AIError, user_message
from ..core.config import ai_enabled, ai_settings
from ..db.connection import connect
from ..schemas.responses import SubmitDraft
from ..tutoring import marker
from ..tutoring.part_context import build_part_context
from . import learning, responses, tutoring
from .storage import Storage, StorageError

logger = logging.getLogger(__name__)


def model_name():
    settings = ai_settings()
    return 'fake' if settings.provider == 'fake' else settings.model


def pipeline_version():
    return f"{prompt('marker').version}/{model_name()}"


def serialize(row, part_id, attempt_number):
    status, result = row['status'], row['result'] or {}
    outcome = result.get('status') if status in ('completed', 'unreadable') else None
    return {
        'id': row['id'], 'question_part_id': part_id, 'attempt_number': attempt_number,
        'status': 'completed' if status == 'unreadable' else status, 'outcome': outcome,
        'marks_awarded': row['marks_awarded'], 'marks_maximum': row['marks_maximum'], 'feedback': row['feedback'],
        'what_i_read': result.get('what_i_read') if outcome == 'marked' else None,
        'error_message': user_message(row['error_code']) if status == 'failed' else None,
        'can_retry': status == 'failed' and row['run_count'] < 2, 'created_at': row['created_at'],
    }


def sweep_stale(cursor):
    # A server restart can stop a background job; surface it as retryable instead of pending forever.
    cursor.execute('''update math_mate.assessments set status = 'failed', error_code = 'interrupted', updated_at = now()
        where status in ('pending', 'processing') and updated_at < now() - interval '3 minutes' ''')


def request_assessment(part_id, body, owner, schedule):
    if not ai_enabled():
        raise HTTPException(503, 'AI marking is not available yet. Your work is saved.')
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        context = tutoring.load_part_context(cursor, part_id)
    if not context.ai_markable:
        raise HTTPException(422, 'AI marking is not available for graph or diagram answers yet. Compare your work with the model answer.')
    submission = responses.submit_response(part_id, SubmitDraft(expected_revision=body.expected_revision), owner)
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        sweep_stale(cursor)
        # Work submitted after any tutor help on this part is assisted evidence, not independent.
        # Evaluated once, when the attempt's assessment is first created.
        cursor.execute('''insert into math_mate.assessments (submission_id, pipeline_version, independent, marks_maximum)
            select %s, %s, not exists (select 1 from math_mate.tutor_turns t
                join math_mate.tutor_sessions s on s.id = t.session_id
                where s.learner_id = %s and s.question_part_id = %s and t.status = 'completed'
                    and t.assistance > 0), %s
            on conflict (submission_id, pipeline_version) do nothing''',
            (submission['id'], pipeline_version(), owner, part_id, context.marks))
        cursor.execute('''select * from math_mate.assessments where submission_id = %s and pipeline_version = %s
            for update''', (submission['id'], pipeline_version()))
        row = cursor.fetchone()
        if row['status'] == 'failed' and row['run_count'] < 2:
            cursor.execute('''update math_mate.assessments set status = 'pending', error_code = null, updated_at = now()
                where id = %s returning *''', (row['id'],))
            row = cursor.fetchone()
        cursor.execute('''select count(distinct a.submission_id) as attempt from math_mate.assessments a
            join math_mate.response_submissions s on s.id = a.submission_id
            where s.response_id = %s and s.response_revision <= %s''',
            (submission['response_id'], submission['response_revision']))
        result = serialize(row, part_id, cursor.fetchone()['attempt'])
    if row['status'] == 'pending':
        schedule(run_assessment, row['id'])
    return result


def _fail(assessment_id, code):
    with connect() as connection:
        connection.execute('''update math_mate.assessments set status = 'failed', error_code = %s, updated_at = now()
            where id = %s and status = 'processing' ''', (code, assessment_id))


def run_assessment(assessment_id):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''update math_mate.assessments set status = 'processing', run_count = run_count + 1,
            started_at = now(), updated_at = now() where id = %s and status = 'pending' returning *''', (assessment_id,))
        row = cursor.fetchone()
        if not row:
            return
        cursor.execute('''select s.typed_work, r.learner_id, r.question_part_id, q.question_data
            from math_mate.response_submissions s
            join math_mate.student_responses r on r.id = s.response_id
            join math_mate.question_parts p on p.id = r.question_part_id
            join math_mate.questions q on q.id = p.question_id where s.id = %s''', (row['submission_id'],))
        work = cursor.fetchone()
        cursor.execute('''select f.bucket, f.object_key from math_mate.submission_attachments a
            join math_mate.solution_files f on f.id = a.file_id where a.submission_id = %s order by a.position''',
            (row['submission_id'],))
        pages = cursor.fetchall()
    try:
        context = build_part_context(work['question_data'], work['question_part_id'])
        storage = Storage() if pages else None
        images = [storage.get(page['bucket'], page['object_key']) for page in pages]
        mark_result = marker.mark(context, work['typed_work'], images, work['learner_id'], assessment_id)
    except AIError as error:
        return _fail(assessment_id, error.code)
    except StorageError:
        return _fail(assessment_id, 'storage')
    except Exception:
        logger.exception('Assessment job failed')
        return _fail(assessment_id, 'internal')
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        complete(cursor, row, work, context, mark_result)


def complete(cursor, row, work, context, mark_result):
    learner_id, part_id = work['learner_id'], work['question_part_id']
    cursor.execute('''select * from math_mate.tutor_sessions
        where learner_id = %s and question_part_id = %s and state = 'active' for update''', (learner_id, part_id))
    session = cursor.fetchone()
    result = {**mark_result.output.model_dump(), 'awarded_point_ids': list(mark_result.awarded_point_ids),
              'points': [{'id': point.id, 'code': point.code, 'value': point.value} for point in context.marking_points]}
    # A job swept as interrupted may still finish; its valid result replaces the interruption.
    cursor.execute('''update math_mate.assessments set status = %s, marks_awarded = %s, result = %s, feedback = %s,
            error_code = null, prompt_version = %s, model = %s, completed_at = now(), updated_at = now()
        where id = %s and (status = 'processing' or error_code = 'interrupted') returning id''',
        ('completed' if mark_result.marked else 'unreadable', mark_result.marks_awarded, Jsonb(result),
         marker.student_feedback(context, mark_result), prompt('marker').version, model_name(), row['id']))
    if not cursor.fetchone() or not mark_result.marked:
        return
    learning.record_assessment(cursor, learner_id, part_id, row['id'], context, mark_result,
                               row['independent'], bool(session and session['solution_shown']))
    tutoring.after_assessment(cursor, learner_id, part_id, row['id'], session, mark_result)


def list_assessments(owner, topic_number):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        sweep_stale(cursor)
        cursor.execute('''select a.*, r.question_part_id,
                dense_rank() over (partition by s.response_id order by s.response_revision) as attempt_number
            from math_mate.assessments a
            join math_mate.response_submissions s on s.id = a.submission_id
            join math_mate.student_responses r on r.id = s.response_id
            join math_mate.question_parts p on p.id = r.question_part_id
            join math_mate.questions q on q.id = p.question_id
            where r.learner_id = %s and q.topic_code = %s
            order by a.created_at, s.response_revision limit 1000''', (owner, topic_number))
        rows = cursor.fetchall()
    return {'assessments': [serialize(row, row['question_part_id'], row['attempt_number']) for row in rows]}
