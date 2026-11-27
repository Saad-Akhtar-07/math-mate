"""Rebuild active context-time BKT states from append-only Marker evidence.

The command is read-only unless --apply is supplied. It does not create
predictions or audit updates because those must remain genuine prospective
records. New users without attempt events receive no state row.
"""

import argparse

from psycopg.rows import dict_row

from ..app.db.connection import connect
from ..app.services.learning import replay_context_history
from ..app.tutoring import bkt


def rebuild(apply=False):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''select user_id, outcome_code, score, weight, created_at
            from math_mate.learning_events where kind = 'attempt'
            order by user_id, outcome_code, created_at, id''')
        histories = {}
        for row in cursor.fetchall():
            histories.setdefault((row['user_id'], row['outcome_code']), []).append(row)
        rows = []
        for (user_id, outcome_code), history in histories.items():
            mastery, evidence_count, last_evidence_at = replay_context_history(history)
            rows.append((user_id, outcome_code, mastery, evidence_count, last_evidence_at))
        print(f'Active model: {bkt.CONTEXT_MODEL_VERSION}')
        print(f'Attempt histories found: {len(rows)} user/outcome states')
        if not apply or not rows:
            return len(rows)
        columns = list(zip(*rows))
        cursor.execute('''insert into math_mate.bkt_states
            (user_id, outcome_code, model_version, mastery, evidence_count, last_evidence_at)
            select r.user_id, r.outcome_code, %s, r.mastery, r.evidence_count, r.last_evidence_at
            from unnest(%s::uuid[], %s::text[], %s::numeric[], %s::int[], %s::timestamptz[])
                as r(user_id, outcome_code, mastery, evidence_count, last_evidence_at)
            on conflict (user_id, outcome_code, model_version) do update set
                mastery = excluded.mastery, evidence_count = excluded.evidence_count,
                last_evidence_at = excluded.last_evidence_at, updated_at = now()''',
            (bkt.CONTEXT_MODEL_VERSION, *[list(column) for column in columns]))
    print('Active BKT states rebuilt and committed.')
    return len(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    count = rebuild(args.apply)
    if not args.apply:
        print('Plan only; use --apply to rebuild these states.')
