"""Verify the Supabase Auth ownership schema without changing data."""

from ..app.db.connection import connect


if __name__ == '__main__':
    with connect() as connection:
        tables = connection.execute('''select table_schema, table_name
            from information_schema.tables
            where (table_schema = 'math_mate' and table_name = any(%s))
               or (table_schema = 'auth' and table_name = 'users')
            order by table_schema, table_name''',
            (['users', 'learners', 'learner_sessions', 'questions', 'question_parts'],)).fetchall()
        users, questions, parts = connection.execute('''select
            (select count(*) from math_mate.users),
            (select count(*) from math_mate.questions),
            (select count(*) from math_mate.question_parts)''').fetchone()
    print('Tables:', ', '.join(f'{schema}.{table}' for schema, table in tables))
    print(f'math_mate.users rows: {users}')
    print(f'questions: {questions}')
    print(f'question_parts: {parts}')
