"""Read ordered image metadata without signing links or downloading files."""


def draft_attachments(cursor, response_ids):
    if not response_ids:
        return {}
    cursor.execute('''select a.id, a.response_id, a.file_id, a.position, a.original_filename,
            f.stored_bytes as byte_size, f.original_bytes, f.media_type, f.width, f.height, f.upload_sha256
        from math_mate.response_attachments a join math_mate.solution_files f on f.id = a.file_id
        where a.response_id = any(%s) and a.removed_at is null and f.state = 'ready'
        order by a.position''', (response_ids,))
    result = {}
    for item in cursor.fetchall():
        result.setdefault(item['response_id'], []).append(item)
    return result


def submission_attachments(cursor, submission_ids):
    if not submission_ids:
        return {}
    cursor.execute('''select a.submission_id, a.file_id, a.position, a.original_filename,
            f.stored_bytes as byte_size, f.media_type, f.width, f.height
        from math_mate.submission_attachments a join math_mate.solution_files f on f.id = a.file_id
        where a.submission_id = any(%s) order by a.position''', (submission_ids,))
    result = {}
    for item in cursor.fetchall():
        result.setdefault(item['submission_id'], []).append(item)
    return result


def current_response(cursor, response_id, owner):
    cursor.execute('''select r.*, exists(select 1 from math_mate.response_submissions s
        where s.response_id = r.id and s.response_revision = r.revision) as submitted
        from math_mate.student_responses r where r.id = %s and r.learner_id = %s''', (response_id, owner))
    row = cursor.fetchone()
    return {**row, 'attachments': draft_attachments(cursor, [response_id]).get(response_id, [])}
