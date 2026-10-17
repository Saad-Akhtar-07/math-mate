"""Check the configured Supabase PostgreSQL connection without changing data."""

import sys

import psycopg

from ..app.db.connection import connect


def main() -> int:
    try:
        with connect() as connection:
            result, database = connection.execute('select 1, current_database()').fetchone()
            if result != 1:
                raise RuntimeError('Unexpected response to SELECT 1')
    except (psycopg.Error, RuntimeError, ValueError) as error:
        print(f'Database health check failed: {error}', file=sys.stderr)
        return 1
    print(f'Database healthy: connected to {database} and SELECT 1 succeeded.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
