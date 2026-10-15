"""Check that Math Mate can connect to its Supabase Postgres database."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

CONFIG_KEYS = (
    "SUPABASE_DB_HOST",
    "SUPABASE_DB_PORT",
    "SUPABASE_DB_NAME",
    "SUPABASE_DB_USER",
    "SUPABASE_DB_PASSWORD",
)


def main() -> int:
    missing = [key for key in CONFIG_KEYS if not os.getenv(key)]
    if missing:
        print(f"Missing database settings: {', '.join(missing)}", file=sys.stderr)
        print("Copy .env.example to .env and fill in the Supabase connection details.", file=sys.stderr)
        return 1

    try:
        with psycopg.connect(
            host=os.environ["SUPABASE_DB_HOST"],
            port=os.environ["SUPABASE_DB_PORT"],
            dbname=os.environ["SUPABASE_DB_NAME"],
            user=os.environ["SUPABASE_DB_USER"],
            password=os.environ["SUPABASE_DB_PASSWORD"],
            sslmode="require",
            connect_timeout=8,
            application_name="math-mate-health-check",
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1, current_database()")
                result, database = cursor.fetchone()
                if result != 1:
                    raise RuntimeError("Unexpected response to SELECT 1")
    except (psycopg.Error, RuntimeError, ValueError) as error:
        print(f"Database health check failed: {error}", file=sys.stderr)
        return 1

    print(f"Database healthy: connected to {database} and SELECT 1 succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
