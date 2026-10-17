"""Guest authentication and response privacy dependencies."""

import hashlib
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..db.connection import connect

bearer = HTTPBearer(auto_error=False)


def private_response(response: Response):
    response.headers['Cache-Control'] = 'no-store'


def learner(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], response: Response):
    private_response(response)
    if not credentials or len(credentials.credentials) > 128:
        raise HTTPException(401, 'Guest session required')
    digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    with connect() as connection:
        row = connection.execute('''select learner_id from math_mate.learner_sessions
            where token_hash = %s and expires_at > now()''', (digest,)).fetchone()
    if not row:
        raise HTTPException(401, 'Guest session expired or invalid. Your local work is still available.')
    return row[0]


Learner = Annotated[UUID, Depends(learner)]
