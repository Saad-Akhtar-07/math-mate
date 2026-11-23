"""Small learner-progress projection for dashboards and question lists."""

from psycopg.rows import dict_row

from ..ai.types import user_message
from ..db.connection import connect


def _review(row):
    status = row['status']
    outcome = row['outcome'] if status in ('completed', 'unreadable', 'needs_review') else None
    return {
        'id': row['id'],
        'question_part_id': row['question_part_id'],
        'attempt_number': row['attempt_number'],
        'status': 'completed' if status in ('unreadable', 'needs_review') else status,
        'outcome': outcome,
        'marks_awarded': row['marks_awarded'],
        'marks_maximum': row['marks_maximum'],
        'feedback': row['feedback'],
        'independent': row['independent'],
        'error_message': user_message(row['error_code']) if status == 'failed' else None,
        'can_retry': status == 'failed' and row['run_count'] < 2,
        'created_at': row['created_at'],
    }


def progress(owner, topic_number):
    """Latest state per part plus a short recent-attempt window, without answer bodies."""
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''with response_rows as (
                select r.question_part_id, r.created_at, r.updated_at,
                    (length(btrim(r.typed_work)) > 0 or r.visual_answer is not null
                        or exists(select 1 from math_mate.response_attachments a
                            join math_mate.solution_files f on f.id = a.file_id
                            where a.response_id = r.id and a.removed_at is null and f.state = 'ready')) as has_work,
                    exists(select 1 from math_mate.response_submissions s
                        where s.response_id = r.id and s.response_revision = r.revision) as submitted
                from math_mate.student_responses r
                join math_mate.question_parts p on p.id = r.question_part_id
                join math_mate.questions q on q.id = p.question_id
                where r.user_id = %(owner)s and q.topic_code = %(topic)s),
            ranked as (
                select a.id,
                    case when a.status in ('pending', 'processing')
                            and a.updated_at < now() - interval '3 minutes' then 'failed' else a.status end as status,
                    a.run_count, a.independent, a.marks_awarded, a.marks_maximum, a.feedback,
                    case when a.status in ('pending', 'processing')
                            and a.updated_at < now() - interval '3 minutes' then 'interrupted' else a.error_code end as error_code,
                    a.created_at, a.result ->> 'status' as outcome,
                    r.question_part_id,
                    dense_rank() over (partition by s.response_id order by s.response_revision) as attempt_number,
                    row_number() over (partition by r.question_part_id
                        order by s.response_revision desc, a.created_at desc) as part_rank,
                    row_number() over (order by a.created_at desc) as recent_rank
                from math_mate.assessments a
                join math_mate.response_submissions s on s.id = a.submission_id
                join math_mate.student_responses r on r.id = s.response_id
                join math_mate.question_parts p on p.id = r.question_part_id
                join math_mate.questions q on q.id = p.question_id
                where r.user_id = %(owner)s and q.topic_code = %(topic)s),
            selected_reviews as (select * from ranked where part_rank = 1 or recent_rank <= 20)
            select
                coalesce((select jsonb_agg(to_jsonb(response_rows)) from response_rows), '[]'::jsonb) as responses,
                coalesce((select jsonb_agg(to_jsonb(selected_reviews) order by created_at)
                    from selected_reviews), '[]'::jsonb) as assessments''',
            {'owner': owner, 'topic': topic_number})
        row = cursor.fetchone()
    return {'responses': row['responses'], 'assessments': [_review(item) for item in row['assessments']]}
