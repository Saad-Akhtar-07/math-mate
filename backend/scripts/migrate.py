"""Apply checked-in migrations transactionally. Defaults to a read-only plan."""

import argparse
import hashlib

from ..app.db.connection import connect
from ..app.core.config import PROJECT_ROOT

MIGRATIONS = PROJECT_ROOT / 'supabase' / 'migrations'


def migrate(connection, apply=False):
    # Serialize concurrent deploys without holding a session-level lock.
    if apply:
        connection.execute("select pg_advisory_xact_lock(4024, 1)")
    ledger = connection.execute("select to_regclass('math_mate.schema_migrations')").fetchone()[0]
    applied = dict(connection.execute('select version, checksum from math_mate.schema_migrations').fetchall()) if ledger else {}
    existing = connection.execute("select to_regclass('math_mate.questions')").fetchone()[0]
    if apply:
        connection.execute('create schema if not exists math_mate')
        connection.execute('''create table if not exists math_mate.schema_migrations (
            version text primary key, checksum text not null, applied_at timestamptz not null default now())''')
        connection.execute('revoke all on math_mate.schema_migrations from public, anon, authenticated')
    for path in sorted(MIGRATIONS.glob('*.sql')):
        sql = path.read_text(encoding='utf-8')
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        if path.stem in applied:
            if applied[path.stem] != checksum:
                raise RuntimeError(f'Applied migration was modified: {path.name}')
            continue
        baseline = path.name == '20261015000000_question_bank.sql' and existing
        print(f'{"Adopt existing" if baseline else "Apply"}: {path.name}')
        if apply:
            if baseline:
                # The first importer predates the ledger. Verify its table contract.
                connection.execute('select id, collection_id, source_file, topic_code, subtopic_codes, question_number, title, total_marks, difficulty_rank, paper_year, paper_session, paper_component, calculator_allowed, question_data, collection_data, created_at, updated_at from math_mate.questions limit 0')
            else:
                connection.execute(sql)
            connection.execute('insert into math_mate.schema_migrations(version, checksum) values (%s, %s)', (path.stem, checksum))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with connect() as connection:
        migrate(connection, args.apply)
    print('Migrations committed.' if args.apply else 'Plan only; use --apply to migrate.')
