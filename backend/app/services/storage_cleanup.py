"""Remove unreferenced solution files while preserving live and submitted pages."""

from psycopg.rows import dict_row

from ..db.connection import connect
from .storage import Storage


def unreferenced(cursor, file_id):
    cursor.execute('''select not exists(select 1 from math_mate.response_attachments
        where file_id = %s and removed_at is null)
        and not exists(select 1 from math_mate.submission_attachments where file_id = %s) as unused''', (file_id, file_id))
    return cursor.fetchone()['unused']


def cleanup(apply=False, limit=100):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select f.id, f.response_id from math_mate.solution_files f
            where (f.updated_at < now() - interval '24 hours' or f.state = 'deleting')
            and not exists(select 1 from math_mate.response_attachments a where a.file_id = f.id and a.removed_at is null)
            and not exists(select 1 from math_mate.submission_attachments a where a.file_id = f.id)
            order by f.updated_at limit %s''', (limit,))
        candidates = cursor.fetchall()
    if not apply:
        return len(candidates)
    storage = Storage()
    removed = 0
    for candidate in candidates:
        with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
            # Upload, removal and cleanup all lock the response before the file.
            cursor.execute('select id from math_mate.student_responses where id = %s for update', (candidate['response_id'],))
            cursor.execute('select * from math_mate.solution_files where id = %s for update', (candidate['id'],))
            file = cursor.fetchone()
            if not file or not unreferenced(cursor, file['id']):
                continue
            cursor.execute("select %s < now() - interval '24 hours' as old", (file['updated_at'],))
            if not cursor.fetchone()['old'] and file['state'] != 'deleting':
                continue
            cursor.execute("update math_mate.solution_files set state = 'deleting' where id = %s", (file['id'],))
        # Keep the durable deletion intent if Storage is unavailable. Retry on
        # the next run; never delete metadata first and lose track of the blob.
        storage.delete(file['bucket'], file['object_key'])
        with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("delete from math_mate.solution_files where id = %s and state = 'deleting'", (file['id'],))
        removed += 1
    return removed
