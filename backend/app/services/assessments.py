"""AI marking jobs: submit, mark, store the validated result.

One assessment exists per submission and pipeline version, so repeated clicks
return the same job. The job claims its row, releases the connection for the
model call, then commits the result, evidence and tutoring state together.
With `wait` the request marks inline and returns the finished result, so the
page does not have to poll; otherwise marking runs after the response is sent.
"""

import logging

from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..ai.prompts import prompt
from ..ai.types import AIError, user_message
from ..core.config import ai_enabled, ai_settings
from ..db.connection import connect
from ..tutoring import marker
from ..tutoring.part_context import build_part_context
from ..tutoring.visual_evidence import build as build_visual_evidence
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
    outcome = result.get('status') if status in ('completed', 'unreadable', 'needs_review') else None
    return {
        'id': row['id'], 'question_part_id': part_id, 'attempt_number': attempt_number,
        'status': 'completed' if status in ('unreadable', 'needs_review') else status, 'outcome': outcome,
        'marks_awarded': row['marks_awarded'], 'marks_maximum': row['marks_maximum'], 'feedback': row['feedback'],
        'what_i_read': result.get('what_i_read') if outcome == 'marked' else None,
        # Attempts marked before the review existed have none; the page shows only what was read.
        'review': result.get('review') if outcome == 'marked' else None,
        'error_message': user_message(row['error_code']) if status == 'failed' else None,
        'can_retry': status == 'failed' and row['run_count'] < 2 and not row.get('visual_submission', False),
        'created_at': row['created_at'],
    }


def sweep_stale(cursor):
    # A server restart can stop a background job; surface it as retryable instead of pending forever.
    cursor.execute('''update math_mate.assessments set status = 'failed', error_code = 'interrupted', updated_at = now()
        where status in ('pending', 'processing') and updated_at < now() - interval '3 minutes' ''')


def _existing(cursor, submission):
    """A repeated request for an already-created assessment: retry it if it failed."""
    sweep_stale(cursor)
    cursor.execute('''select * from math_mate.assessments where submission_id = %s and pipeline_version = %s
        for update''', (submission['id'], pipeline_version()))
    row = cursor.fetchone()
    if row['status'] == 'failed' and row['run_count'] < 2 and not submission.get('visual_answer'):
        cursor.execute('''update math_mate.assessments set status = 'pending', error_code = null, updated_at = now()
            where id = %s returning *''', (row['id'],))
        row = cursor.fetchone()
    cursor.execute('''select count(distinct a.submission_id) as attempt from math_mate.assessments a
        join math_mate.response_submissions s on s.id = a.submission_id
        where s.response_id = %s and s.response_revision <= %s''',
        (submission['response_id'], submission['response_revision']))
    return {**row, 'attempt_number': cursor.fetchone()['attempt']}


def request_assessment(part_id, body, owner, schedule, wait=False):
    if not ai_enabled():
        raise HTTPException(503, 'AI marking is not available yet. Your work is saved.')
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        submission, question = responses.submit(cursor, part_id, body.expected_revision, owner)
        try:
            context = build_part_context(question['question_data'], part_id)
        except KeyError:
            raise HTTPException(404, 'Question part not found or retired') from None
        if context.visual_response:
            visual = submission.get('visual_answer') or {}
            source = visual.get('primary_source')
            source_matches = submission.get('primary_visual_source') == source
            canvas_ready = source != 'canvas' or bool(visual.get('objects'))
            if source not in ('canvas', 'photo') or not source_matches or not canvas_ready:
                # Raising rolls back the submission as well, so an incomplete or
                # stale visual never becomes an attempt or consumes a model call.
                raise HTTPException(422, 'Add or upload the complete visual answer before checking your work.')
        # Work submitted after any tutor help on this part is assisted evidence, not independent.
        # Evaluated once, when the attempt's assessment is first created. The attempt number
        # counts earlier assessed submissions; RETURNING cannot see the new row, hence + 1.
        cursor.execute('''insert into math_mate.assessments (submission_id, pipeline_version, independent, marks_maximum)
            select %(submission)s, %(pipeline)s, not exists (select 1 from math_mate.tutor_turns t
                join math_mate.tutor_sessions s on s.id = t.session_id
                where s.user_id = %(owner)s and s.question_part_id = %(part)s and t.status = 'completed'
                    and t.assistance > 0), %(marks)s
            on conflict (submission_id, pipeline_version) do nothing
            returning *, 1 + (select count(distinct a.submission_id) from math_mate.assessments a
                join math_mate.response_submissions s on s.id = a.submission_id
                where s.response_id = %(response)s and s.response_revision <= %(revision)s) as attempt_number''',
            {'submission': submission['id'], 'pipeline': pipeline_version(), 'owner': owner, 'part': part_id,
             'marks': context.marks, 'response': submission['response_id'], 'revision': submission['response_revision']})
        row = cursor.fetchone() or _existing(cursor, submission)
    attempt = row['attempt_number']
    if row['status'] == 'pending':
        if wait:
            # Runs after the commit above. If the browser gives up, the job still finishes and polling shows it.
            row = run_assessment(row['id']) or row
        else:
            schedule(run_assessment, row['id'])
    return serialize({**row, 'visual_submission': context.visual_response}, part_id, attempt)


def _fail(assessment_id, code):
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''update math_mate.assessments set status = 'failed', error_code = %s, updated_at = now()
            where id = %s and status = 'processing' returning *''', (code, assessment_id))
        return cursor.fetchone()


def run_assessment(assessment_id):
    """Mark one pending assessment. Returns its final row, or None if another worker claimed it."""
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        # Claim the job and load the work and its pages in one statement.
        cursor.execute('''with claimed as (update math_mate.assessments set status = 'processing',
                run_count = run_count + 1, started_at = now(), updated_at = now()
                where id = %s and status = 'pending' returning *)
            select c.*, s.typed_work, s.visual_answer, r.user_id, r.question_part_id, q.question_data,
                coalesce((select jsonb_agg(jsonb_build_object('bucket', f.bucket, 'object_key', f.object_key,
                        'role', a.role, 'visual_source', a.visual_source, 'filename', a.original_filename)
                        order by (a.role = 'primary_visual') desc, a.position)
                    from math_mate.submission_attachments a join math_mate.solution_files f on f.id = a.file_id
                    where a.submission_id = c.submission_id), '[]') as pages
            from claimed c
            join math_mate.response_submissions s on s.id = c.submission_id
            join math_mate.student_responses r on r.id = s.response_id
            join math_mate.question_parts p on p.id = r.question_part_id
            join math_mate.questions q on q.id = p.question_id''', (assessment_id,))
        work = cursor.fetchone()
    if not work:
        return None
    try:
        context = build_part_context(work['question_data'], work['question_part_id'])
        storage = Storage() if work['pages'] else None
        images = [{'data': storage.get(page['bucket'], page['object_key']),
                   'label': (f"Primary student {page.get('visual_source') or 'visual'} answer"
                             if page.get('role') == 'primary_visual'
                             else f"Supporting work: {page.get('filename') or 'page'}")}
                  for page in work['pages']]
        visual = work.get('visual_answer') or {}
        evidence = build_visual_evidence(visual) if context.visual_response and visual.get('primary_source') == 'canvas' else None
        mark_result = marker.mark(context, work['typed_work'], images, work['user_id'], assessment_id,
                                  visual_evidence=evidence)
    except AIError as error:
        return _fail(assessment_id, error.code)
    except StorageError:
        return _fail(assessment_id, 'storage')
    except Exception:
        logger.exception('Assessment job failed')
        return _fail(assessment_id, 'internal')
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        return complete(cursor, work, context, mark_result)


def complete(cursor, work, context, mark_result):
    """Store the result, evidence and tutoring state. `work` is the claimed assessment row with its work."""
    user_id, part_id = work['user_id'], work['question_part_id']
    cursor.execute('''select * from math_mate.tutor_sessions
        where user_id = %s and question_part_id = %s and state = 'active' for update''', (user_id, part_id))
    session = cursor.fetchone()
    result = {**mark_result.output.model_dump(), 'awarded_point_ids': list(mark_result.awarded_point_ids),
              'points': [{'id': point.id, 'code': point.code, 'value': point.value} for point in context.marking_points]}
    if mark_result.marked:
        result['review'] = marker.student_review(context, mark_result)
    # A job swept as interrupted may still finish; its valid result replaces the interruption.
    cursor.execute('''update math_mate.assessments set status = %s, marks_awarded = %s, result = %s, feedback = %s,
            error_code = null, prompt_version = %s, model = %s, completed_at = now(), updated_at = now()
        where id = %s and (status = 'processing' or error_code = 'interrupted') returning *''',
        ('completed' if mark_result.marked else
         ('needs_review' if mark_result.output.status == 'needs_review' else 'unreadable'),
         mark_result.marks_awarded, Jsonb(result),
         marker.student_feedback(context, mark_result), prompt('marker').version, model_name(), work['id']))
    updated = cursor.fetchone()
    if not updated or not mark_result.marked:
        return updated
    learning.record_assessment(cursor, user_id, part_id, work['id'], context, mark_result,
                               work['independent'], bool(session and session['solution_shown']))
    tutoring.after_assessment(cursor, user_id, part_id, work['id'], session, mark_result)
    return updated


def list_assessments(owner, topic_number):
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''with history as (
                select a.*, s.response_revision, r.question_part_id,
                    (s.visual_answer is not null) as visual_submission,
                    dense_rank() over (partition by s.response_id order by s.response_revision) as attempt_number,
                    case when a.status in ('pending', 'processing')
                            and a.updated_at < now() - interval '3 minutes' then 'failed' else a.status end as effective_status,
                    case when a.status in ('pending', 'processing')
                            and a.updated_at < now() - interval '3 minutes' then 'interrupted' else a.error_code end as effective_error_code
                from math_mate.assessments a
                join math_mate.response_submissions s on s.id = a.submission_id
                join math_mate.student_responses r on r.id = s.response_id
                join math_mate.question_parts p on p.id = r.question_part_id
                join math_mate.questions q on q.id = p.question_id
                where r.user_id = %s and q.topic_code = %s)
            select * from history order by created_at desc, response_revision desc, id desc limit 250''',
            (owner, topic_number))
        rows = cursor.fetchall()
    rows.reverse()
    for row in rows:
        row['status'] = row.pop('effective_status')
        row['error_code'] = row.pop('effective_error_code')
    return {'assessments': [serialize(row, row['question_part_id'], row['attempt_number']) for row in rows]}
