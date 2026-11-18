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
            where user_id = %s and question_part_id = %s for share''', (owner, part_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(404, 'Saved answer not found')
        return current_response(cursor, row['id'], owner)


def list_responses(owner: UUID, topic_number: str, after: str = '', limit: int = 100):
    # Read-only listing: autocommit skips BEGIN and COMMIT round trips.
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select r.*, exists (select 1 from math_mate.response_submissions s
                where s.response_id = r.id and s.response_revision = r.revision) as submitted
            from math_mate.student_responses r
            join math_mate.question_parts p on p.id = r.question_part_id
            join math_mate.questions q on q.id = p.question_id
            where r.user_id = %s and q.topic_code = %s and r.question_part_id > %s
            order by r.question_part_id limit %s''', (owner, topic_number, after, limit + 1))
        rows = cursor.fetchall()
        images = draft_attachments(cursor, [row['id'] for row in rows[:limit]])
    return {'responses': [serialize_response(row, images.get(row['id'])) for row in rows[:limit]],
            'next_cursor': rows[limit - 1]['question_part_id'] if len(rows) > limit else None}


def save_response(part_id: str, body: SaveDraft, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        # Lock question content against imports until this write has committed,
        # and create the draft on its first save, in one round trip.
        cursor.execute('''with question as (select q.id from math_mate.questions q
                join math_mate.question_parts p on p.question_id = q.id
                where p.id = %(part)s and p.active for share of q),
            created as (insert into math_mate.student_responses(user_id, question_part_id, typed_work)
                select %(owner)s, %(part)s, %(text)s from question where %(revision)s = 0
                on conflict (user_id, question_part_id) do nothing returning id)
            select exists(select 1 from question) as found, exists(select 1 from created) as created''',
            {'part': part_id, 'owner': owner, 'text': body.typed_work, 'revision': body.expected_revision})
        status = cursor.fetchone()
        if not status['found']:
            raise HTTPException(404, 'Question part not found or retired')
        cursor.execute('''select r.*, exists(select 1 from math_mate.response_submissions s
                where s.response_id = r.id and s.response_revision = r.revision) as submitted
            from math_mate.student_responses r
            where r.user_id = %s and r.question_part_id = %s for update of r''', (owner, part_id))
        row = cursor.fetchone()
        # Equal content is an idempotent retry, even if the previous response was lost.
        if not row or (not status['created'] and row['typed_work'] != body.typed_work and row['revision'] != body.expected_revision):
            raise HTTPException(409, 'This answer changed in another tab. Reload saved work before replacing it; your local draft has been kept.')
        if row['typed_work'] != body.typed_work:
            # A new revision has never been submitted.
            cursor.execute('''update math_mate.student_responses
                set typed_work = %s, revision = revision + 1, updated_at = now()
                where id = %s returning *, false as submitted''', (body.typed_work, row['id']))
            row = cursor.fetchone()
        images = draft_attachments(cursor, [row['id']]).get(row['id'], [])
    return serialize_response(row, images)


def submit(cursor, part_id: str, expected_revision: int, owner: UUID):
    """Snapshot the saved draft inside the caller's transaction. Returns (submission, question row)."""
    # One round trip: the question (shared lock against imports), the draft (update
    # lock), an earlier submission of this revision and whether the draft has pages.
    cursor.execute('''with draft as (select id, revision, typed_work from math_mate.student_responses
            where user_id = %(owner)s and question_part_id = %(part)s for update)
        select q.*, d.id as draft_id, d.revision as draft_revision, d.typed_work as draft_typed_work,
            (select s.id from math_mate.response_submissions s
                where s.response_id = d.id and s.response_revision = %(revision)s) as existing_id,
            exists(select 1 from math_mate.response_attachments a
                join math_mate.solution_files f on f.id = a.file_id
                where a.response_id = d.id and a.removed_at is null and f.state = 'ready') as has_pages
        from math_mate.questions q join math_mate.question_parts p on p.question_id = q.id
        left join draft d on true
        where p.id = %(part)s and p.active for share of q''',
        {'owner': owner, 'part': part_id, 'revision': expected_revision})
    question = cursor.fetchone()
    if not question:
        raise HTTPException(404, 'Question part not found or retired')
    if not question['draft_id']:
        raise HTTPException(404, 'Save an answer before submitting')
    # Check the historical key first: retrying a successful submission must
    # remain idempotent even if the learner has since edited their draft.
    if question['existing_id']:
        cursor.execute('select * from math_mate.response_submissions where id = %s', (question['existing_id'],))
        return cursor.fetchone(), question
    if question['draft_revision'] != expected_revision:
        raise HTTPException(409, 'The saved answer changed. Save your latest work before submitting.')
    if not question['draft_typed_work'].strip() and not question['has_pages']:
        raise HTTPException(422, 'Write an answer or upload a solution page before submitting')
    public = public_question(question)
    snapshot = {key: public.get(key) for key in ('id', 'title', 'prompt', 'paper')}
    snapshot['part'] = next(part for part in public['parts'] if part['id'] == part_id)
    # The submission and copies of its pages are inserted by one statement.
    cursor.execute('''with submitted as (insert into math_mate.response_submissions
            (response_id, response_revision, typed_work, question_snapshot)
            values (%s, %s, %s, %s) returning *),
        pages as (insert into math_mate.submission_attachments
            (submission_id, response_id, file_id, position, original_filename)
            select s.id, a.response_id, a.file_id, a.position, a.original_filename
            from submitted s join math_mate.response_attachments a on a.response_id = s.response_id
            where a.removed_at is null)
        select * from submitted''',
        (question['draft_id'], question['draft_revision'], question['draft_typed_work'], Jsonb(snapshot)))
    return cursor.fetchone(), question


def submit_response(part_id: str, body: SubmitDraft, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        submitted, _ = submit(cursor, part_id, body.expected_revision, owner)
        return {**submitted, 'attachments': submission_attachments(cursor, [submitted['id']]).get(submitted['id'], [])}


def list_submissions(part_id: str, owner: UUID, before: int | None = None, limit: int = 20):
    # Read-only listing: autocommit skips BEGIN and COMMIT round trips.
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select s.* from math_mate.response_submissions s
            join math_mate.student_responses r on r.id = s.response_id
            where r.user_id = %s and r.question_part_id = %s
                and (%s::integer is null or s.response_revision < %s)
            order by s.response_revision desc limit %s''', (owner, part_id, before, before, limit + 1))
        rows = cursor.fetchall()
        images = submission_attachments(cursor, [row['id'] for row in rows[:limit]])
    return {'submissions': [{**row, 'attachments': images.get(row['id'], [])} for row in rows[:limit]],
            'next_cursor': rows[limit - 1]['response_revision'] if len(rows) > limit else None}
