"""Check the configured PostgreSQL connections without changing data."""

import argparse
import sys

import psycopg

from ..app.db.connection import connect
from .targets import add_target_argument, selected_targets


def check(target) -> bool:
    try:
        with connect(target=target) as connection:
            result, database = connection.execute('select 1, current_database()').fetchone()
            if result != 1:
                raise RuntimeError('Unexpected response to SELECT 1')
    except (psycopg.Error, RuntimeError, ValueError) as error:
        print(f'[{target}] Database health check failed: {error}', file=sys.stderr)
        return False
    print(f'[{target}] Database healthy: connected to {database} and SELECT 1 succeeded.')
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    add_target_argument(parser)
    args = parser.parse_args()
    results = [check(target) for target in selected_targets(args.target)]
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
