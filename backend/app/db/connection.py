"""Server-only PostgreSQL connection settings for Math Mate.

Every statement costs one network round trip, and a transaction adds two more
(BEGIN and COMMIT). Single-statement reads and writes therefore use
`connect(autocommit=True)`, and pooled connections used moments ago skip the
health-check ping.
"""

import os
import time
import weakref
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool
from ..core.config import DATABASE_TARGETS, database_env_keys, database_target

# A connection returned this recently is almost certainly alive; a broken one
# fails its next statement and the pool replaces it.
RECENTLY_USED_SECONDS = 30

_pool = None
_last_returned = weakref.WeakKeyDictionary()


def connection_settings(target=None):
    """Settings for the MATH_MATE_DB database, or for `target` when given."""
    target = target or database_target()
    keys = database_env_keys(target)
    missing = [key for key in keys if not os.getenv(key)]
    if missing:
        raise RuntimeError(f"Missing database settings for {target}: {', '.join(missing)}")
    host, port, dbname, user, password = (os.environ[key] for key in keys)
    return dict(
        host=host, port=port, dbname=dbname, user=user, password=password,
        # Supabase always requires TLS; a local development database may run without it.
        sslmode=os.getenv(f"{DATABASE_TARGETS[target]}_SSLMODE", "require" if target == "supabase" else "prefer"),
        connect_timeout=8,
        application_name="math-mate-backend",
    )


def _check(connection):
    if time.monotonic() - _last_returned.get(connection, 0) > RECENTLY_USED_SECONDS:
        ConnectionPool.check_connection(connection)


def _reset(connection):
    # Called by the pool with the connection idle; undo any autocommit block.
    connection.autocommit = False
    _last_returned[connection] = time.monotonic()


def start_pool():
    global _pool
    _pool = ConnectionPool(kwargs=connection_settings(), min_size=1,
                           max_size=int(os.getenv('MATH_MATE_DB_POOL_SIZE', '5')),
                           max_waiting=30, timeout=10, open=False, check=_check, reset=_reset)
    _pool.open(wait=True)


def stop_pool():
    global _pool
    if _pool:
        _pool.close()
        _pool = None


@contextmanager
def connect(autocommit=False, target=None):
    """A pooled connection. With autocommit each statement commits on its own, saving BEGIN and COMMIT.

    Command-line tools may name a `target` database; the API always uses MATH_MATE_DB.
    """
    if _pool and target is None:
        with _pool.connection() as connection:
            connection.autocommit = autocommit
            yield connection
    else:
        with psycopg.connect(**connection_settings(target), autocommit=autocommit) as connection:
            yield connection
