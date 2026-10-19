"""Guest authentication and response privacy dependencies."""

import hashlib
import time
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..db.connection import connect

bearer = HTTPBearer(auto_error=False)

# Sessions are never revoked early, only expire, so a verified token can be
# trusted until the sooner of its expiry and this many seconds. This saves a
# database round trip on almost every request.
SESSION_CACHE_SECONDS = 300
SESSION_CACHE_LIMIT = 10_000
_sessions = {}


def private_response(response: Response):
    response.headers['Cache-Control'] = 'no-store'


def _cached(digest):
    entry = _sessions.get(digest)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    _sessions.pop(digest, None)
    return None


def _remember(digest, learner_id, expires_at):
    if SESSION_CACHE_SECONDS <= 0:
        return
    if len(_sessions) >= SESSION_CACHE_LIMIT:
        _sessions.clear()
    remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
    _sessions[digest] = (learner_id, time.monotonic() + min(SESSION_CACHE_SECONDS, remaining))


def learner(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], response: Response):
    private_response(response)
    if not credentials or len(credentials.credentials) > 128:
        raise HTTPException(401, 'Guest session required')
    digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    if cached := _cached(digest):
        return cached
    with connect(autocommit=True) as connection:
        row = connection.execute('''select learner_id, expires_at from math_mate.learner_sessions
            where token_hash = %s and expires_at > now()''', (digest,)).fetchone()
    if not row:
        raise HTTPException(401, 'Guest session expired or invalid. Your local work is still available.')
    _remember(digest, *row)
    return row[0]


Learner = Annotated[UUID, Depends(learner)]
