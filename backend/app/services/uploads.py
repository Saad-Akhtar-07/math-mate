"""Transactional page uploads, draft removal and owned image access."""

from uuid import UUID, uuid4

from fastapi import HTTPException
from psycopg.rows import dict_row

from ..db.connection import connect
from ..repositories.solution_files import current_response, draft_attachments
from .image_processing import ImageBusy, InvalidImage, compress_page
from .storage import Storage


def lock_draft(cursor, owner, part_id):
    # Match the lock order used by text saves and submission snapshots.
    cursor.execute('''select q.id from math_mate.questions q
        join math_mate.question_parts p on p.question_id = q.id
        where p.id = %s and p.active for share of q''', (part_id,))
    if not cursor.fetchone():
        raise HTTPException(404, 'Question part not found or retired')
    cursor.execute('''select * from math_mate.student_responses
        where learner_id = %s and question_part_id = %s for update''', (owner, part_id))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, 'Save your work before uploading a page')
    return row


def check_revision(draft, expected):
    if draft['revision'] != expected:
        raise HTTPException(409, 'This answer changed in another tab. Reload saved work before changing its pages.')


def upload_page(part_id: str, owner: UUID, raw: bytes, filename: str | None, expected_revision: int):
    try:
        page = compress_page(raw)
    except InvalidImage as error:
        raise HTTPException(422, str(error)) from error
    except ImageBusy as error:
        raise HTTPException(503, str(error)) from error
    storage = Storage()
    filename = (filename or 'solution-page').replace('\\', '/').split('/')[-1].strip()[:255] or 'solution-page'
    # Commit an intent before network I/O. A crash can leave an unreferenced
    # object, but never an untracked object: cleanup can always find its key.
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        draft = lock_draft(cursor, owner, part_id)
        cursor.execute('''select a.id from math_mate.response_attachments a
            join math_mate.solution_files f on f.id = a.file_id
            where a.response_id = %s and a.removed_at is null and f.upload_sha256 = %s''', (draft['id'], page.upload_sha256))
        if cursor.fetchone():
            return current_response(cursor, draft['id'], owner)
        check_revision(draft, expected_revision)
        attachments = draft_attachments(cursor, [draft['id']]).get(draft['id'], [])
        if len(attachments) >= 4:
            raise HTTPException(422, 'You can attach up to 4 pages to one answer.')
        file_id = uuid4()
        object_key = f'{owner}/{draft["id"]}/{file_id}.jpg'
        cursor.execute('''insert into math_mate.solution_files
            (id, response_id, bucket, object_key, upload_sha256, sha256, original_bytes, stored_bytes, width, height)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (response_id, upload_sha256) do update set updated_at = now()
            returning *''', (file_id, draft['id'], storage.bucket, object_key, page.upload_sha256,
                            page.sha256, page.original_bytes, len(page.data), page.width, page.height))
        file = cursor.fetchone()
        if file['state'] == 'deleting':
            raise HTTPException(409, 'An unused copy of this image is being cleaned up. Please retry shortly.')
    if file['state'] == 'pending':
        storage.put(file['object_key'], page.data)
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        draft = lock_draft(cursor, owner, part_id)
        cursor.execute('''select * from math_mate.solution_files where id = %s for update''', (file['id'],))
        latest_file = cursor.fetchone()
        if not latest_file or latest_file['state'] == 'deleting':
            raise HTTPException(409, 'This upload expired before it completed. Please retry.')
        attachments = draft_attachments(cursor, [draft['id']]).get(draft['id'], [])
        if any(item['file_id'] == file['id'] for item in attachments):
            return current_response(cursor, draft['id'], owner)
        check_revision(draft, expected_revision)
        if len(attachments) >= 4:
            raise HTTPException(422, 'You can attach up to 4 pages to one answer.')
        cursor.execute("update math_mate.solution_files set state = 'ready', updated_at = now() where id = %s", (file['id'],))
        cursor.execute('''insert into math_mate.response_attachments(response_id, file_id, position, original_filename)
            values (%s, %s, %s, %s)''', (draft['id'], file['id'], len(attachments) + 1, filename))
        cursor.execute('''update math_mate.student_responses set revision = revision + 1, updated_at = now()
            where id = %s''', (draft['id'],))
        return current_response(cursor, draft['id'], owner)


def remove_page(part_id: str, attachment_id: UUID, owner: UUID, expected_revision: int):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        draft = lock_draft(cursor, owner, part_id)
        cursor.execute('''select * from math_mate.response_attachments where id = %s and response_id = %s''', (attachment_id, draft['id']))
        attachment = cursor.fetchone()
        if not attachment:
            raise HTTPException(404, 'Solution page not found')
        if attachment['removed_at'] is not None:
            return current_response(cursor, draft['id'], owner)
        check_revision(draft, expected_revision)
        cursor.execute('update math_mate.response_attachments set removed_at = now() where id = %s', (attachment_id,))
        remaining = draft_attachments(cursor, [draft['id']]).get(draft['id'], [])
        # Vacate active slots before renumbering to avoid transient uniqueness
        # collisions; the transaction makes the new order visible atomically.
        ids = [item['id'] for item in remaining]
        cursor.execute('update math_mate.response_attachments set removed_at = now() where id = any(%s)', (ids,))
        for position, item in enumerate(remaining, 1):
            cursor.execute('update math_mate.response_attachments set position = %s, removed_at = null where id = %s', (position, item['id']))
        cursor.execute('update math_mate.student_responses set revision = revision + 1, updated_at = now() where id = %s', (draft['id'],))
        return current_response(cursor, draft['id'], owner)


def page_url(file_id: UUID, owner: UUID):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select f.bucket, f.object_key from math_mate.solution_files f
            join math_mate.student_responses r on r.id = f.response_id
            where f.id = %s and r.learner_id = %s and f.state = 'ready' ''', (file_id, owner))
        file = cursor.fetchone()
    if not file:
        raise HTTPException(404, 'Solution page not found')
    return {'url': Storage().signed_url(file['bucket'], file['object_key']), 'expires_in': 900}
