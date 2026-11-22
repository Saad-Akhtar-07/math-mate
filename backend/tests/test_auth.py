"""Supabase authentication is required for private API ownership."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response

from backend.app.api import dependencies


def credentials(token=None):
    return SimpleNamespace(scheme='Bearer', credentials=token or str(uuid4()))


def test_verified_auth_user_is_ensured(monkeypatch):
    user_id = uuid4()
    monkeypatch.setattr(dependencies, 'verify_access_token', lambda _token: user_id)
    monkeypatch.setattr(dependencies, 'ensure_user', lambda value: value)
    assert dependencies.user(credentials(), Response()) == user_id


def test_missing_auth_is_rejected():
    with pytest.raises(HTTPException) as caught:
        dependencies.user(None, Response())
    assert caught.value.status_code == 401


def test_invalid_auth_is_rejected(monkeypatch):
    def invalid(_token):
        raise HTTPException(401, 'invalid')
    monkeypatch.setattr(dependencies, 'verify_access_token', invalid)
    with pytest.raises(HTTPException) as caught:
        dependencies.user(credentials(), Response())
    assert caught.value.status_code == 401
