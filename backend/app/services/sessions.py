"""Issue guest learner identities and hashed session credentials."""

import hashlib
import secrets

from ..db.connection import connect


def create_session():
    token = secrets.token_urlsafe(32)
    with connect(autocommit=True) as connection:
        # One statement creates both rows atomically.
        expires_at = connection.execute('''with learner as (insert into math_mate.learners default values returning id)
            insert into math_mate.learner_sessions(learner_id, token_hash)
            select id, %s from learner returning expires_at''',
            (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()[0]
    return {'access_token': token, 'token_type': 'bearer', 'expires_at': expires_at}
