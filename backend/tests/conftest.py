"""Shared guards and the rollback-only database fixture.

Every test uses the free fake AI provider and cannot open a real network
connection, even when DEEPSEEK_API_KEY is configured. Live provider tests live
in tests/live and need MATH_MATE_LIVE_AI_TEST=1 plus an approved batch.
"""

import os
from contextlib import contextmanager
from uuid import UUID

import httpx
import pytest

from backend.app.ai import gateway
from backend.app.ai.providers import reset_fake_provider
from backend.app.core.config import PROJECT_ROOT

# Sentinel table or function and its migration, applied inside the rolled-back test transaction when missing.
MIGRATIONS = (
    ('student_responses', '20261016000000_learner_solutions.sql'),
    ('solution_files', '20261016010000_solution_images.sql'),
    ('assessments', '20261020000000_ai_tutoring.sql'),
    ('reserve_llm_call', '20261021000000_llm_call_reservation.sql'),
)


class MemoryLedger:
    def __init__(self):
        self.calls = []

    def reserve(self, request, provider, model, estimate):
        self.calls.append({'purpose': request.purpose, 'provider': provider, 'estimate': estimate, 'status': 'pending'})
        return len(self.calls) - 1

    def settle(self, call_id, status, usage, cost_usd, latency_ms):
        self.calls[call_id].update(status=status, usage=usage, cost=cost_usd)


@pytest.fixture(autouse=True)
def no_paid_ai(request, monkeypatch):
    if request.node.get_closest_marker('live'):
        yield
        return
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'fake')
    monkeypatch.delenv('MATH_MATE_LIVE_AI_TEST', raising=False)
    reset_fake_provider()

    def blocked(_transport, outgoing):
        raise RuntimeError(f'Unexpected network request to {outgoing.url.host} during tests')
    # Mock transports and the ASGI test client do not use HTTPTransport, so they still work.
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', blocked)
    yield
    reset_fake_provider()


@pytest.fixture
def ledger(monkeypatch):
    memory = MemoryLedger()
    monkeypatch.setattr(gateway, 'ledger', memory)
    return memory


@pytest.fixture
def client(monkeypatch):
    if os.getenv('MATH_MATE_TEST_DB') != '1':
        pytest.skip('Set MATH_MATE_TEST_DB=1 for rollback-only database tests')
    from fastapi import HTTPException
    from fastapi.testclient import TestClient
    from backend.app import main as api
    from backend.app.api import dependencies
    from backend.app.db.connection import connect
    from backend.app.services import (assessments, questions, responses, storage_cleanup,
                                      tutoring, uploads)

    questions.clear_content_cache()
    with connect() as connection, connection.transaction(force_rollback=True):
        if connection.execute("select to_regclass('math_mate.users')").fetchone()[0] is None:
            pytest.skip('Apply 20261118000000_supabase_auth_users.sql before database tests.')
        for table, filename in MIGRATIONS:
            name = f'math_mate.{table}'
            if connection.execute('select coalesce(to_regclass(%s)::text, to_regproc(%s)::text)', (name, name)).fetchone()[0] is None:
                connection.execute((PROJECT_ROOT / 'supabase/migrations' / filename).read_text(encoding='utf-8'))
        # BKT was introduced under shadow table names and later promoted. Apply
        # whichever additive stages are absent inside this rollback-only test.
        bkt_state = connection.execute("select coalesce(to_regclass('math_mate.bkt_states'), to_regclass('math_mate.bkt_shadow_states'))").fetchone()[0]
        if bkt_state is None:
            connection.execute((PROJECT_ROOT / 'supabase/migrations' / '20261127000000_shadow_bkt.sql').read_text(encoding='utf-8'))
        bkt_updates = connection.execute("select coalesce(to_regclass('math_mate.bkt_updates'), to_regclass('math_mate.bkt_shadow_updates'))").fetchone()[0]
        if bkt_updates is None:
            connection.execute((PROJECT_ROOT / 'supabase/migrations' / '20261127010000_context_time_bkt.sql').read_text(encoding='utf-8'))
        if connection.execute("select to_regclass('math_mate.bkt_states')").fetchone()[0] is None:
            connection.execute((PROJECT_ROOT / 'supabase/migrations' / '20261127020000_promote_context_bkt.sql').read_text(encoding='utf-8'))
        visual_column = connection.execute("""select 1 from information_schema.columns
            where table_schema = 'math_mate' and table_name = 'student_responses'
                and column_name = 'visual_answer'""").fetchone()
        if visual_column is None:
            connection.execute((PROJECT_ROOT / 'supabase/migrations' / '20261122000000_visual_answers.sql').read_text(encoding='utf-8'))
        visual_source_column = connection.execute("""select 1 from information_schema.columns
            where table_schema = 'math_mate' and table_name = 'response_attachments'
                and column_name = 'visual_source'""").fetchone()
        if visual_source_column is None:
            connection.execute((PROJECT_ROOT / 'supabase/migrations' / '20261122010000_primary_visual_source.sql').read_text(encoding='utf-8'))

        @contextmanager
        def request_connection(autocommit=False):
            # A failed request rolls back its own savepoint, as in production.
            with connection.transaction():
                yield connection
        for module in (dependencies, questions, responses, uploads, storage_cleanup,
                       assessments, tutoring, gateway):
            monkeypatch.setattr(module, 'connect', request_connection)
        def verify_test_token(token):
            try:
                return UUID(token)
            except ValueError:
                raise HTTPException(401, 'Invalid test token') from None
        monkeypatch.setattr(dependencies, 'verify_access_token', verify_test_token)

        def ensure_test_user(user_id):
            connection.execute('insert into math_mate.users(id) values (%s) on conflict (id) do nothing', (user_id,))
            return user_id
        monkeypatch.setattr(dependencies, 'ensure_user', ensure_test_user)
        yield TestClient(api.app), connection
    questions.clear_content_cache()
