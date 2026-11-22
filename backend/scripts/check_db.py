"""Check the configured PostgreSQL connections without changing data."""

import argparse
import sys

import psycopg

from ..app.db.connection import connect
def check() -> bool:
    try:
        with connect() as connection:
            result, database = connection.execute('select 1, current_database()').fetchone()
            if result != 1:
                raise RuntimeError('Unexpected response to SELECT 1')
    except (psycopg.Error, RuntimeError, ValueError) as error:
        print(f'Supabase database health check failed: {error}', file=sys.stderr)
        return False
    print(f'Supabase database healthy: connected to {database} and SELECT 1 succeeded.')
    return True


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    return 0 if check() else 1


if __name__ == '__main__':
    sys.exit(main())
