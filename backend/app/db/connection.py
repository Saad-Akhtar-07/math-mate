"""Server-only PostgreSQL connection settings for Math Mate."""

import os
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool
from ..core.config import DATABASE_ENV_KEYS


_pool = None


def connection_settings():
    missing = [key for key in DATABASE_ENV_KEYS if not os.getenv(key)]
    if missing:
        raise RuntimeError(f"Missing database settings: {', '.join(missing)}")
    return dict(
        host=os.environ["SUPABASE_DB_HOST"],
        port=os.environ["SUPABASE_DB_PORT"],
        dbname=os.environ["SUPABASE_DB_NAME"],
        user=os.environ["SUPABASE_DB_USER"],
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
        connect_timeout=8,
        application_name="math-mate-backend",
    )


def start_pool():
    global _pool
    _pool = ConnectionPool(kwargs=connection_settings(), min_size=1,
                           max_size=int(os.getenv('MATH_MATE_DB_POOL_SIZE', '5')),
                           max_waiting=30, timeout=10, open=False,
                           check=ConnectionPool.check_connection)
    _pool.open(wait=True)


def stop_pool():
    global _pool
    if _pool:
        _pool.close()
        _pool = None


@contextmanager
def connect():
    if _pool:
        with _pool.connection() as connection:
            yield connection
    else:
        with psycopg.connect(**connection_settings()) as connection:
            yield connection
