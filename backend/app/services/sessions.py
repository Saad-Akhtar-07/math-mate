"""Issue guest learner identities and hashed session credentials."""

import hashlib
import secrets

from ..db.connection import connect


def create_session():
    token = secrets.token_urlsafe(32)
    with connect() as connection:
        learner_id = connection.execute('insert into math_mate.learners default values returning id').fetchone()[0]
        session = connection.execute('''insert into math_mate.learner_sessions(learner_id, token_hash)
            values (%s, %s) returning expires_at''',
            (learner_id, hashlib.sha256(token.encode()).hexdigest())).fetchone()
    return {'access_token': token, 'token_type': 'bearer', 'expires_at': session[0]}
