"""Plan or permanently remove all pre-launch guest activity, preserving questions."""

import argparse

from ..app.db.connection import connect
from ..app.services.storage import Storage, StorageError


def counts(connection):
    return connection.execute('''select
        (select count(*) from math_mate.learners) as users,
        (select count(*) from math_mate.student_responses) as responses,
        (select count(*) from math_mate.solution_files) as files''').fetchone()


def reset(apply=False):
    with connect() as connection:
        if connection.execute("select to_regclass('math_mate.learners')").fetchone()[0] is None:
            raise RuntimeError('The guest schema is already gone; no reset is needed.')
        summary = counts(connection)
        files = connection.execute(
            'select bucket, object_key from math_mate.solution_files order by created_at'
        ).fetchall()
    print(f'Guest users: {summary[0]}; saved responses: {summary[1]}; stored solution pages: {summary[2]}')
    if not apply:
        print('Plan only; use --apply to delete this activity. Curated questions are never touched.')
        return

    if files:
        storage = Storage()
        for bucket, object_key in files:
            storage.delete(bucket, object_key)

    with connect() as connection:
        # CASCADE reaches every user-owned table, including the AI usage ledger,
        # but not questions or question_parts.
        connection.execute('truncate table math_mate.learners cascade')
    print('All guest activity and solution images were removed. Questions were preserved.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        reset(args.apply)
    except (RuntimeError, StorageError) as error:
        raise SystemExit(str(error)) from None
