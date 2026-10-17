"""Transactional draft saves and immutable submission snapshots."""

from uuid import UUID

from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db.connection import connect
from ..repositories.solution_files import current_response, draft_attachments, submission_attachments
from ..schemas.responses import SaveDraft, SubmitDraft
from .question_content import public_question


def serialize_response(row, attachments=None):
    return {**row, 'attachments': attachments or []}


def get_response(part_id: str, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        # Page mutations take an update lock on this row. Hold a shared lock
        # while reading both the revision and pages so retry checks agree.
        cursor.execute('''select id from math_mate.student_responses
            where learner_id = %s and question_part_id = %s for share''', (owner, part_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(404, 'Saved answer not found')
        return current_response(cursor, row['id'], owner)


def list_responses(owner: UUID, topic_number: str, after: str = '', limit: int = 100):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select r.*, exists (select 1 from math_mate.response_submissions s
                where s.response_id = r.id and s.response_revision = r.revision) as submitted
            from math_mate.student_responses r
            join math_mate.question_parts p on p.id = r.question_part_id
            join math_mate.questions q on q.id = p.question_id
            where r.learner_id = %s and q.topic_code = %s and r.question_part_id > %s
            order by r.question_part_id limit %s''', (owner, topic_number, after, limit + 1))
        rows = cursor.fetchall()
        images = draft_attachments(cursor, [row['id'] for row in rows[:limit]])
    return {'responses': [serialize_response(row, images.get(row['id'])) for row in rows[:limit]],
            'next_cursor': rows[limit - 1]['question_part_id'] if len(rows) > limit else None}


def save_response(part_id: str, body: SaveDraft, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        # Lock question content against imports until this write has committed.
        cursor.execute('''select q.id from math_mate.questions q
            join math_mate.question_parts p on p.question_id = q.id
            where p.id = %s and p.active for share of q''', (part_id,))
        if not cursor.fetchone():
            raise HTTPException(404, 'Question part not found or retired')
        cursor.execute('''insert into math_mate.student_responses(learner_id, question_part_id, typed_work)
            select %s, %s, %s where %s = 0
            on conflict (learner_id, question_part_id) do nothing''',
            (owner, part_id, body.typed_work, body.expected_revision))
        created = cursor.rowcount == 1
        cursor.execute('''select * from math_mate.student_responses
            where learner_id = %s and question_part_id = %s for update''', (owner, part_id))
        row = cursor.fetchone()
        # Equal content is an idempotent retry, even if the previous response was lost.
        if not row or (not created and row['typed_work'] != body.typed_work and row['revision'] != body.expected_revision):
            raise HTTPException(409, 'This answer changed in another tab. Reload saved work before replacing it; your local draft has been kept.')
        if row['typed_work'] != body.typed_work:
            cursor.execute('''update math_mate.student_responses
                set typed_work = %s, revision = revision + 1, updated_at = now()
                where id = %s returning *''', (body.typed_work, row['id']))
            row = cursor.fetchone()
        cursor.execute('''select exists(select 1 from math_mate.response_submissions
            where response_id = %s and response_revision = %s) as submitted''', (row['id'], row['revision']))
        row['submitted'] = cursor.fetchone()['submitted']
        images = draft_attachments(cursor, [row['id']]).get(row['id'], [])
    return serialize_response(row, images)


def submit_response(part_id: str, body: SubmitDraft, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select q.* from math_mate.questions q
            join math_mate.question_parts p on p.question_id = q.id
            where p.id = %s and p.active for share of q''', (part_id,))
        question = cursor.fetchone()
        if not question:
            raise HTTPException(404, 'Question part not found or retired')
        cursor.execute('''select * from math_mate.student_responses
            where learner_id = %s and question_part_id = %s for update''', (owner, part_id))
        draft = cursor.fetchone()
        if not draft:
            raise HTTPException(404, 'Save an answer before submitting')
        # Check the historical key first: retrying a successful submission must
        # remain idempotent even if the learner has since edited their draft.
        cursor.execute('''select * from math_mate.response_submissions
            where response_id = %s and response_revision = %s''', (draft['id'], body.expected_revision))
        existing = cursor.fetchone()
        if existing:
            return {**existing, 'attachments': submission_attachments(cursor, [existing['id']]).get(existing['id'], [])}
        if draft['revision'] != body.expected_revision:
            raise HTTPException(409, 'The saved answer changed. Save your latest work before submitting.')
        images = draft_attachments(cursor, [draft['id']]).get(draft['id'], [])
        if not draft['typed_work'].strip() and not images:
            raise HTTPException(422, 'Write an answer or upload a solution page before submitting')
        public = public_question(question)
        snapshot = {key: public.get(key) for key in ('id', 'title', 'prompt', 'paper')}
        snapshot['part'] = next(part for part in public['parts'] if part['id'] == part_id)
        cursor.execute('''insert into math_mate.response_submissions
            (response_id, response_revision, typed_work, question_snapshot)
            values (%s, %s, %s, %s) returning *''',
            (draft['id'], draft['revision'], draft['typed_work'], Jsonb(snapshot)))
        submitted = cursor.fetchone()
        cursor.execute('''insert into math_mate.submission_attachments
            (submission_id, response_id, file_id, position, original_filename)
            select %s, a.response_id, a.file_id, a.position, a.original_filename
            from math_mate.response_attachments a where a.response_id = %s and a.removed_at is null''',
            (submitted['id'], draft['id']))
        return {**submitted, 'attachments': submission_attachments(cursor, [submitted['id']]).get(submitted['id'], [])}


def list_submissions(part_id: str, owner: UUID, before: int | None = None, limit: int = 20):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select s.* from math_mate.response_submissions s
            join math_mate.student_responses r on r.id = s.response_id
            where r.learner_id = %s and r.question_part_id = %s
                and (%s::integer is null or s.response_revision < %s)
            order by s.response_revision desc limit %s''', (owner, part_id, before, before, limit + 1))
        rows = cursor.fetchall()
        images = submission_attachments(cursor, [row['id'] for row in rows[:limit]])
    return {'submissions': [{**row, 'attachments': images.get(row['id'], [])} for row in rows[:limit]],
            'next_cursor': rows[limit - 1]['response_revision'] if len(rows) > limit else None}
