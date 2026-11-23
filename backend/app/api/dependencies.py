"""Verified Supabase authentication and private-response dependencies."""

from functools import lru_cache
import threading
import time
from typing import Annotated
from uuid import UUID

import jwt
import httpx
from fastapi import Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError

from ..core.config import auth_settings
from ..db.connection import connect

bearer = HTTPBearer(auto_error=False)
USER_CACHE_SECONDS = 300
_known_users = {}
_known_users_guard = threading.Lock()

def private_response(response: Response):
    response.headers['Cache-Control'] = 'no-store'


@lru_cache(maxsize=4)
def _jwks_client(url):
    return PyJWKClient(url, cache_keys=True)


def verify_access_token(token: str) -> UUID:
    settings = auth_settings()
    if not settings['issuer'] or not settings['jwks_url']:
        raise RuntimeError('SUPABASE_URL is required for user authentication.')
    try:
        signing_key = _jwks_client(settings['jwks_url']).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256', 'ES256'],
            audience=settings['audience'],
            issuer=settings['issuer'],
            options={'require': ['exp', 'iss', 'sub', 'aud']},
        )
        if claims.get('role') != 'authenticated' or claims.get('is_anonymous') is True:
            raise jwt.InvalidTokenError('A permanent account is required.')
        return UUID(claims['sub'])
    except PyJWKClientError:
        # Older Supabase projects can still use a shared signing secret, which
        # is intentionally not copied into this app. Validate those tokens at
        # the Auth server instead.
        if not settings['publishable_key']:
            raise RuntimeError('SUPABASE_PUBLISHABLE_KEY is required for this project\'s Auth signing setup.') from None
        try:
            response = httpx.get(
                f"{settings['url']}/auth/v1/user",
                headers={'apikey': settings['publishable_key'], 'Authorization': f'Bearer {token}'},
                timeout=httpx.Timeout(8),
            )
        except httpx.HTTPError:
            raise RuntimeError('Supabase Auth is temporarily unavailable.') from None
        if response.status_code != 200:
            raise HTTPException(401, 'Your sign-in session is invalid or expired. Please sign in again.')
        try:
            auth_user = response.json()
            if not auth_user.get('email_confirmed_at') or auth_user.get('is_anonymous') is True:
                raise ValueError
            return UUID(auth_user['id'])
        except (ValueError, KeyError, TypeError):
            raise HTTPException(401, 'A verified email account is required.') from None
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, 'Your sign-in session is invalid or expired. Please sign in again.') from None


def ensure_user(user_id: UUID):
    now = time.monotonic()
    with _known_users_guard:
        if _known_users.get(user_id, 0) > now:
            return user_id
    with connect(autocommit=True) as connection:
        row = connection.execute('''with existing as (
                select id from math_mate.users where id = %(user)s
            ), inserted as (
                insert into math_mate.users(id, auth_user_id)
                select %(user)s, %(user)s where not exists(select 1 from existing)
                on conflict (id) do nothing returning id)
            select id from existing union all select id from inserted limit 1''', {'user': user_id}).fetchone()
        # Two first requests can race: the loser sees neither the other
        # transaction's insert nor its own ON CONFLICT result in this snapshot.
        if not row:
            row = connection.execute('select id from math_mate.users where id = %s', (user_id,)).fetchone()
    if not row:
        raise HTTPException(401, 'Your account could not be connected to Math Mate.')
    with _known_users_guard:
        _known_users[user_id] = time.monotonic() + USER_CACHE_SECONDS
        if len(_known_users) > 10000:
            _known_users.clear()
            _known_users[user_id] = time.monotonic() + USER_CACHE_SECONDS
    return row[0]


def user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], response: Response):
    private_response(response)
    if not credentials or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, 'Sign in is required.')
    try:
        return ensure_user(verify_access_token(credentials.credentials))
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from None


User = Annotated[UUID, Depends(user)]
