"""The guest-session cache saves a database round trip without outliving a session."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response

from backend.app.api import dependencies


@pytest.fixture
def lookups(monkeypatch):
    learner_id, expires = uuid4(), {'at': datetime.now(timezone.utc) + timedelta(days=1)}
    queries = []

    class Connection:
        def execute(self, _sql, params):
            queries.append(params)
            return SimpleNamespace(fetchone=lambda: (learner_id, expires['at']) if expires['at'] > datetime.now(timezone.utc) else None)

    @contextmanager
    def connect(autocommit=False):
        yield Connection()
    monkeypatch.setattr(dependencies, 'connect', connect)
    monkeypatch.setattr(dependencies, '_sessions', {})
    return SimpleNamespace(queries=queries, learner_id=learner_id, expires=expires)


def authenticate(token='guest-token'):
    return dependencies.learner(SimpleNamespace(credentials=token), Response())


def test_a_verified_token_is_reused_without_a_query(lookups):
    assert authenticate() == lookups.learner_id
    assert authenticate() == lookups.learner_id
    assert len(lookups.queries) == 1


def test_the_cache_never_outlives_the_session(lookups, monkeypatch):
    lookups.expires['at'] = datetime.now(timezone.utc) + timedelta(seconds=1)
    authenticate()
    clock = dependencies.time.monotonic() + 2
    monkeypatch.setattr(dependencies.time, 'monotonic', lambda: clock)
    lookups.expires['at'] = datetime.now(timezone.utc) - timedelta(seconds=1)
    with pytest.raises(HTTPException) as caught:
        authenticate()
    assert caught.value.status_code == 401 and len(lookups.queries) == 2


def test_unknown_tokens_are_not_cached(lookups):
    lookups.expires['at'] = datetime.now(timezone.utc) - timedelta(seconds=1)
    for _ in range(2):
        with pytest.raises(HTTPException):
            authenticate('unknown')
    assert len(lookups.queries) == 2
