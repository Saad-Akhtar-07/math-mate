"""Run an approved fair-start paid comparison on a fresh synthetic learner.

The fixed sequence is declared before forecasts are read. Weighted mastery and
contextual BKT receive the same Marker labels and tutoring contexts. Only
independent attempts are scored. The script never accepts a browser token and
never runs from the normal test suite.
"""

import argparse
import math
import os
import uuid

from psycopg.rows import dict_row

from ..app.core.config import ai_settings
from ..app.db.connection import connect
from ..app.schemas.responses import SaveDraft, SubmitDraft
from ..app.services import assessments, responses
from ..app.tutoring import bkt, policy


# Fixed before predictions are viewed. Every part is a one-mark, text-only
# question whose primary learning outcome is 2.5.1.
CASES = (
    ('4024-s23-11-q4-a-i', 'Final answer: t + 5', 'independent', False),
    ('4024-s23-11-q4-a-ii', 'Final answer: 2t', 'assisted', True),
    ('4024-s24-11-q6-b', 'Final answer: 7x + 5y', 'independent', True),
    ('4024-s25-12-q11-b', 'The equation is 6x + y = 13', 'after_solution', True),
    ('4024-w22-22-q5-a-i', 'The equation is x - y = 130', 'independent', False),
    ('4024-w22-22-q5-a-ii', 'The equation is 5x + 10y = 8.15', 'assisted', False),
    ('4024-w22-21-q8-a', 'Time = 50/x hours', 'independent', True),
    ('4024-w24-22-q10-a', 'Mass = 9/x kilograms', 'independent', False),
    ('4024-w25-12-q22-a', '4 hours is 240 minutes, so 240/x cards', 'independent', True),
)


def parse_args():
    parser = argparse.ArgumentParser()
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


def add_tutoring_context(user_id, part_id, context_name):
    if context_name == bkt.INDEPENDENT:
        return
    solution_shown = context_name == bkt.AFTER_SOLUTION
    assistance = 5 if solution_shown else 2
    move = 'full_solution' if solution_shown else 'formula_reminder'
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''insert into math_mate.tutor_sessions
            (user_id, question_part_id, level, max_assistance, turn_count, solution_shown, policy_version)
            values (%s, %s, %s, %s, 1, %s, %s) returning id''',
            (user_id, part_id, assistance, assistance, solution_shown, policy.POLICY_VERSION))
        session_id = cursor.fetchone()['id']
        cursor.execute('''insert into math_mate.tutor_turns
            (session_id, user_id, client_message_id, intent, learner_message, teaching_move,
             assistance, tutor_message, status, policy_version, completed_at)
            values (%s, %s, %s, 'message', %s, %s, %s, %s, 'completed', %s, now())''',
            (session_id, user_id, uuid.uuid4(),
             'Please show the solution' if solution_shown else 'Please give me a hint',
             move, assistance,
             'A complete solution was shown.' if solution_shown else 'A small hint was given.',
             policy.POLICY_VERSION))


def metrics(rows, field):
    probabilities = [float(row[field]) for row in rows]
    observations = [1.0 if row['observed_correct'] else 0.0 for row in rows]
    brier = sum((prediction - actual) ** 2 for prediction, actual in zip(probabilities, observations)) / len(rows)
    epsilon = 1e-9
    log_loss = -sum(actual * math.log(max(epsilon, prediction))
                    + (1.0 - actual) * math.log(max(epsilon, 1.0 - prediction))
                    for prediction, actual in zip(probabilities, observations)) / len(rows)
    return brier, log_loss


def main():
    args = parse_args()
    if not args.apply:
        raise SystemExit('Dry run only. Add --apply after approving the bounded paid batch.')
    os.environ['MATH_MATE_MARKER_MAX_TOKENS'] = '512'
    os.environ['MATH_MATE_MARKER_REASONING_EFFORT'] = 'low'
    settings = ai_settings()
    if settings.provider != 'deepseek' or settings.model != 'deepseek-flash':
        raise SystemExit('Refusing live batch: expected configured deepseek/deepseek-flash provider.')

    synthetic_user = uuid.uuid4()
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('insert into math_mate.users(id) values (%s)', (synthetic_user,))
        started_at = scalar(cursor, 'select clock_timestamp()')
    print(f'BATCH synthetic_user={synthetic_user} started={started_at.isoformat()}')
    print(f'Model={settings.model}; max_tokens=512; reasoning_effort=low; request_cap={args.max_provider_requests}')

    completed = 0
    for part_id, typed_work, context_name, intended_correct in CASES:
        with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
            used = request_count(cursor, synthetic_user, started_at)
        # A text assessment may make its initial call plus one validation repair.
        if args.max_provider_requests - used < 2:
            print(f'STOP remaining={args.max_provider_requests - used}; reserving room for a possible repair call')
            break
        add_tutoring_context(synthetic_user, part_id, context_name)
        saved = responses.save_response(part_id, SaveDraft(
            typed_work=typed_work, visual_answer=None, expected_revision=0), synthetic_user)
        result = assessments.request_assessment(
            part_id, SubmitDraft(expected_revision=saved['revision']), synthetic_user,
            schedule=lambda *_: None, wait=True)
        completed += 1

        with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
            used = request_count(cursor, synthetic_user, started_at)
            cursor.execute('''select a.status, a.independent, a.marks_awarded, a.marks_maximum,
                    p.observed_correct, p.weighted_prediction, p.bkt_prediction,
                    p.bkt_evidence_count_before
                from math_mate.assessments a
                left join math_mate.learner_model_predictions p on p.assessment_id = a.id
                    and p.outcome_code = '2.5.1' and p.bkt_model_version = %s
                where a.id = %s''', (bkt.CONTEXT_MODEL_VERSION, result['id']))
            row = cursor.fetchone()
        print('RESULT '
              f'part={part_id} context={context_name} intended_correct={intended_correct} '
              f'status={row["status"]} marks={row["marks_awarded"]}/{row["marks_maximum"]} '
              f'independent={row["independent"]} observed_correct={row["observed_correct"]} '
              f'weighted={row["weighted_prediction"]} context_bkt={row["bkt_prediction"]} '
              f'prior_context_evidence={row["bkt_evidence_count_before"]} provider_requests={used}')

    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        used = request_count(cursor, synthetic_user, started_at)
        cursor.execute('''select observed_correct, weighted_prediction, bkt_prediction
            from math_mate.learner_model_predictions
            where user_id = %s and outcome_code = '2.5.1' and bkt_model_version = %s
            order by created_at, id''', (synthetic_user, bkt.CONTEXT_MODEL_VERSION))
        predictions = cursor.fetchall()
        cursor.execute('''select attempt_context, count(*) as observations
            from math_mate.bkt_updates where user_id = %s and outcome_code = '2.5.1'
            group by attempt_context order by attempt_context''', (synthetic_user,))
        contexts = cursor.fetchall()
        cursor.execute('''select status, count(*) as requests,
                coalesce(sum(cache_hit_tokens), 0) as cache_hit,
                coalesce(sum(cache_miss_tokens), 0) as cache_miss,
                coalesce(sum(completion_tokens), 0) as completion,
                coalesce(sum(reasoning_tokens), 0) as reasoning,
                coalesce(sum(cost_usd), 0) as cost
            from math_mate.llm_calls
            where user_id = %s and purpose = 'marker' and created_at >= %s
            group by status order by status''', (synthetic_user, started_at))
        usage = cursor.fetchall()

    print(f'BATCH completed_assessments={completed} provider_requests={used} scored_independent={len(predictions)}')
    print(f'CONTEXTS {contexts}')
    if predictions:
        weighted = metrics(predictions, 'weighted_prediction')
        contextual = metrics(predictions, 'bkt_prediction')
        print(f'METRICS weighted_brier={weighted[0]:.6f} weighted_log_loss={weighted[1]:.6f} '
              f'context_bkt_brier={contextual[0]:.6f} context_bkt_log_loss={contextual[1]:.6f}')
    for row in usage:
        print('USAGE '
              f'status={row["status"]} requests={row["requests"]} cache_hit={row["cache_hit"]} '
              f'cache_miss={row["cache_miss"]} completion={row["completion"]} '
              f'reasoning={row["reasoning"]} cost_usd={row["cost"]}')


if __name__ == '__main__':
    main()
