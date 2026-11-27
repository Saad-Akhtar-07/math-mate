"""Run one explicitly approved, bounded live Marker batch for shadow-BKT evaluation.

This is intentionally not part of normal tests. It uses fixed, text-only
synthetic responses, counts every provider request from the LLM ledger, and
never accepts or stores a browser access token.
"""

import argparse
import os
from datetime import datetime
from uuid import UUID

from psycopg.rows import dict_row

from ..app.core.config import ai_settings
from ..app.db.connection import connect
from ..app.schemas.responses import SaveDraft, SubmitDraft
from ..app.services import assessments, responses


# The alternating labels were fixed before any model predictions were viewed.
# All parts have primary outcome 2.5.1 and have no image input.
CASES = (
    ('4024-s23-11-q4-a-ii', 'Final answer: t', False),
    ('4024-s24-11-q6-b', 'Final answer: 7x + 5y', True),
    ('4024-s24-12-q9-a', 'Final answer: 4x + 3', False),
    ('4024-s24-21-q5-a', '60 + 6(65) = 450. Final answer: 450', True),
    ('4024-s25-12-q11-a', '4x + 6y = 30, so x + y = 30', False),
    ('4024-s25-12-q11-b', 'The equation is 6x + y = 13', True),
    ('4024-w22-22-q5-a-i', 'The equation is x - y = 130', False),
    ('4024-w22-22-q5-a-ii', 'The equation is 5x + 10y = 815', True),
    ('4024-s25-23-q18-a', 'Height = 3x and width = x + 4', False),
    ('4024-w22-21-q8-a', 'Time = 50/x hours', True),
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', required=True, type=UUID)
    parser.add_argument('--max-provider-requests', type=int, default=10, choices=range(1, 11))
    parser.add_argument('--apply', action='store_true', help='Required acknowledgement that this spends API credit')
    return parser.parse_args()


def scalar(cursor, query, params=()):
    cursor.execute(query, params)
    row = cursor.fetchone()
    return next(iter(row.values())) if isinstance(row, dict) else row[0]


def request_count(cursor, user_id, started_at):
    return scalar(cursor, '''select count(*) from math_mate.llm_calls
        where user_id = %s and purpose = 'marker' and created_at >= %s''', (user_id, started_at))


def part_is_unused(cursor, user_id, part_id):
    cursor.execute('''select
        not exists (select 1 from math_mate.assessments a
            join math_mate.response_submissions s on s.id = a.submission_id
            join math_mate.student_responses r on r.id = s.response_id
            where r.user_id = %(user)s and r.question_part_id = %(part)s) as no_assessment,
        not exists (select 1 from math_mate.tutor_sessions ts
            join math_mate.tutor_turns tt on tt.session_id = ts.id
            where ts.user_id = %(user)s and ts.question_part_id = %(part)s
                and tt.status = 'completed' and tt.assistance > 0) as no_help''',
        {'user': user_id, 'part': part_id})
    row = cursor.fetchone()
    return row['no_assessment'] and row['no_help']


def current_revision(cursor, user_id, part_id):
    cursor.execute('''select revision from math_mate.student_responses
        where user_id = %s and question_part_id = %s''', (user_id, part_id))
    row = cursor.fetchone()
    return row['revision'] if row else 0


def main():
    args = parse_args()
    if not args.apply:
        raise SystemExit('Dry run only. Add --apply after approving the bounded paid batch.')

    # These process-local limits cannot alter the deployed app configuration.
    os.environ['MATH_MATE_MARKER_MAX_TOKENS'] = '512'
    os.environ['MATH_MATE_MARKER_REASONING_EFFORT'] = 'low'
    settings = ai_settings()
    if settings.provider != 'deepseek' or settings.model != 'deepseek-flash':
        raise SystemExit('Refusing live batch: expected configured deepseek/deepseek-flash provider.')

    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        started_at = scalar(cursor, 'select clock_timestamp()')
        exists = scalar(cursor, 'select exists(select 1 from math_mate.users where id = %s)', (args.user_id,))
        if not exists:
            raise SystemExit('User does not exist.')

    print(f'Batch started: {started_at.isoformat()}')
    print(f'Model={settings.model}; max_tokens=512; reasoning_effort=low; request_cap={args.max_provider_requests}')
    completed = 0
    for part_id, typed_work, intended_correct in CASES:
        with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
            used = request_count(cursor, args.user_id, started_at)
            # Text marking can make one initial call plus one format/validation repair.
            if args.max_provider_requests - used < 2:
                print(f'STOP remaining={args.max_provider_requests - used}; reserving room for a possible repair call')
                break
            if not part_is_unused(cursor, args.user_id, part_id):
                print(f'SKIP part={part_id}; prior assessment or tutor help exists')
                continue
            revision = current_revision(cursor, args.user_id, part_id)

        saved = responses.save_response(part_id, SaveDraft(
            typed_work=typed_work, visual_answer=None, expected_revision=revision), args.user_id)
        result = assessments.request_assessment(
            part_id, SubmitDraft(expected_revision=saved['revision']), args.user_id,
            schedule=lambda *_: None, wait=True)
        completed += 1

        with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
            used = request_count(cursor, args.user_id, started_at)
            cursor.execute('''select a.status, a.independent, a.marks_awarded, a.marks_maximum,
                    p.observed_correct, p.weighted_prediction, p.bkt_prediction,
                    p.bkt_evidence_count_before
                from math_mate.assessments a
                left join math_mate.learner_model_predictions p on p.assessment_id = a.id
                where a.id = %s''', (result['id'],))
            row = cursor.fetchone()
        print('RESULT '
              f'part={part_id} intended_correct={intended_correct} status={row["status"]} '
              f'marks={row["marks_awarded"]}/{row["marks_maximum"]} independent={row["independent"]} '
              f'observed_correct={row["observed_correct"]} weighted={row["weighted_prediction"]} '
              f'bkt={row["bkt_prediction"]} prior_bkt_evidence={row["bkt_evidence_count_before"]} '
              f'provider_requests_used={used}')

    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        used = request_count(cursor, args.user_id, started_at)
        cursor.execute('''select status, count(*) as requests,
                coalesce(sum(cache_hit_tokens), 0) as cache_hit,
                coalesce(sum(cache_miss_tokens), 0) as cache_miss,
                coalesce(sum(completion_tokens), 0) as completion,
                coalesce(sum(reasoning_tokens), 0) as reasoning,
                coalesce(sum(cost_usd), 0) as cost
            from math_mate.llm_calls
            where user_id = %s and purpose = 'marker' and created_at >= %s
            group by status order by status''', (args.user_id, started_at))
        usage = cursor.fetchall()
    print(f'BATCH completed_assessments={completed} provider_requests={used}')
    for row in usage:
        print('USAGE '
              f'status={row["status"]} requests={row["requests"]} cache_hit={row["cache_hit"]} '
              f'cache_miss={row["cache_miss"]} completion={row["completion"]} '
              f'reasoning={row["reasoning"]} cost_usd={row["cost"]}')


if __name__ == '__main__':
    main()
