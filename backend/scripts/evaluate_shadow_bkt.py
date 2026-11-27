"""Read-only summary of weighted-versus-BKT pre-observation forecasts."""

import argparse
import math
from uuid import UUID

from psycopg.rows import dict_row

from ..app.db.connection import connect


def metrics(rows, field):
    if not rows:
        return None
    probabilities = [float(row[field]) for row in rows]
    observations = [1.0 if row['observed_correct'] else 0.0 for row in rows]
    epsilon = 1e-9
    brier = sum((prediction - actual) ** 2 for prediction, actual in zip(probabilities, observations)) / len(rows)
    log_loss = -sum(actual * math.log(max(epsilon, prediction))
                    + (1.0 - actual) * math.log(max(epsilon, 1.0 - prediction))
                    for prediction, actual in zip(probabilities, observations)) / len(rows)
    return brier, log_loss


def line(label, rows):
    weighted = metrics(rows, 'weighted_prediction')
    bkt = metrics(rows, 'bkt_prediction')
    correct = sum(row['observed_correct'] for row in rows)
    print(f'{label}: {len(rows)} observations ({correct} correct)')
    if not rows:
        print('  No evidence yet.')
        return
    print(f'  Weighted: Brier={weighted[0]:.4f}, log loss={weighted[1]:.4f}')
    print(f'  BKT:      Brier={bkt[0]:.4f}, log loss={bkt[1]:.4f}')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', type=UUID, help='Limit the report to one learner profile')
    parser.add_argument('--outcome-code', help='Limit the report to one learning outcome')
    return parser.parse_args()


def evaluate(user_id=None, outcome_code=None):
    with connect(autocommit=True) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select observed_correct, weighted_prediction, bkt_prediction,
                bkt_evidence_count_before, bkt_model_version
            from math_mate.learner_model_predictions
            where (%s::uuid is null or user_id = %s)
                and (%s::text is null or outcome_code = %s)
            order by created_at, id''', (user_id, user_id, outcome_code, outcome_code))
        rows = cursor.fetchall()
    versions = sorted({row['bkt_model_version'] for row in rows})
    if not versions:
        print('No shadow predictions yet. Independent marked attempts will create them.')
        return
    for version in versions:
        selected = [row for row in rows if row['bkt_model_version'] == version]
        print(f'\nModel {version}')
        line('Cold start', [row for row in selected if row['bkt_evidence_count_before'] == 0])
        line('Follow-up', [row for row in selected if row['bkt_evidence_count_before'] > 0])
        line('Overall', selected)
        if not any(row['bkt_evidence_count_before'] > 0 for row in selected):
            print('  No personalization evidence yet; do not use cold-start results to choose a winner.')


if __name__ == '__main__':
    args = parse_args()
    evaluate(args.user_id, args.outcome_code)
