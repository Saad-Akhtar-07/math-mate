"""Let administrative tools act on one configured database or on all of them.

Schema migrations and the curated question bank belong in every database, so
`--target all` applies them to Supabase and the local development database in
turn. Learner data is never copied between databases.
"""

from ..app.core.config import DATABASE_TARGETS, database_configured, database_target


def add_target_argument(parser):
    parser.add_argument('--target', choices=('current', *DATABASE_TARGETS, 'all'), default='current',
                        help='current = the MATH_MATE_DB database (default); all = every configured database')


def selected_targets(choice):
    if choice == 'current':
        return [database_target()]
    if choice == 'all':
        targets = [target for target in DATABASE_TARGETS if database_configured(target)]
        if not targets:
            raise SystemExit('No database is configured in .env.')
        return targets
    return [choice]
