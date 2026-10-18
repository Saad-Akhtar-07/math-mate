"""End-to-end marking, tutoring and memory with the fake provider. Everything is rolled back.

Requires MATH_MATE_TEST_DB=1 (see the `client` fixture in conftest.py). No paid AI requests are made.
"""

import json
import uuid
from decimal import Decimal

import pytest

from backend.app.ai import gateway
from backend.app.ai.providers import fake_provider
from backend.app.ai.types import BudgetExceeded, LLMRequest, ProviderTimeout
from backend.app.tutoring.part_context import build_part_context
from helpers import guest, learner_id, save

PART = '4024-s23-22-q2-a'
WRONG = '5p + 8 x 75 = 910\n5p = 1510\np = 302'
RIGHT = '5p + 600 = 910\n5p = 310\np = 62'


def assess(http, headers, revision, part_id=PART):
    return http.post(f'/api/v1/me/responses/{part_id}/assessments', headers=headers, json={'expected_revision': revision})


def turn(http, headers, message, intent='message', client_id=None):
    return http.post(f'/api/v1/me/question-parts/{PART}/tutor-turns', headers=headers,
                     json={'client_message_id': str(client_id or uuid.uuid4()), 'message': message, 'intent': intent})


def assessments(http, headers):
    return http.get('/api/v1/me/assessments?topic_number=2', headers=headers).json()['assessments']


def calls(connection, purpose):
    return connection.execute('select count(*) from math_mate.llm_calls where purpose = %s', (purpose,)).fetchone()[0]


def test_mark_tutor_resubmit_and_remember(client):
    http, connection = client
    headers = guest(http)
    owner = learner_id(connection, headers)
    before = {purpose: calls(connection, purpose) for purpose in ('marker', 'observer', 'composer')}
    assert save(http, headers, PART, WRONG).status_code == 200

    first = assess(http, headers, 1)
    assert first.status_code == 202 and first.json()['status'] == 'pending' and first.json()['attempt_number'] == 1
    marked = assessments(http, headers)[0]
    assert (marked['status'], marked['outcome'], marked['marks_awarded'], marked['marks_maximum']) == ('completed', 'marked', 0, 3)
    assert marked['what_i_read'] == WRONG and '62' not in marked['feedback']
    assert assess(http, headers, 1).json()['id'] == first.json()['id']

    hint = turn(http, headers, 'Please give me one small hint.', 'hint')
    assert hint.status_code == 200 and hint.headers['cache-control'] == 'no-store'
    assert (hint.json()['status'], hint.json()['teaching_move']) == ('completed', 'formula_reminder')
    fixed = turn(http, headers, 'Is it p = 62?')
    assert fixed.json()['teaching_move'] == 'invite_resubmit'

    revision = save(http, headers, PART, RIGHT, 1).json()['revision']
    second = assess(http, headers, revision)
    assert second.json()['attempt_number'] == 2
    latest = [item for item in assessments(http, headers) if item['id'] == second.json()['id']][0]
    assert latest['marks_awarded'] == 3

    session = connection.execute('''select state, max_assistance, turn_count from math_mate.tutor_sessions
        where learner_id = %s''', (owner,)).fetchall()
    assert session == [('resolved', 2, 2)]
    events = connection.execute('''select outcome_code, score, weight from math_mate.learning_events
        where learner_id = %s and kind = 'attempt' ''', (owner,)).fetchall()
    assert sorted((code, float(score), float(weight)) for code, score, weight in events) == [
        ('2.5.1', 0.0, 1.0), ('2.5.1', 1.0, 0.5), ('2.5.2', 0.0, 1.0), ('2.5.2', 1.0, 0.5)]
    states = connection.execute('''select outcome_code, attempts, independent_full_marks from math_mate.learner_outcome_state
        where learner_id = %s order by outcome_code''', (owner,)).fetchall()
    assert states == [('2.5.1', 2, 0), ('2.5.2', 2, 0)]
    # Two Marker calls, one Observer call for the typed message, one Composer call for the hint.
    assert {purpose: calls(connection, purpose) - before[purpose] for purpose in before} == {'marker': 2, 'observer': 1, 'composer': 1}

    other = guest(http)
    assert assessments(http, other) == []
    assert http.get('/api/v1/me/tutor-turns?topic_number=2', headers=other).json()['turns'] == []
    turns = http.get('/api/v1/me/tutor-turns?topic_number=2', headers=headers).json()['turns']
    assert {item['teaching_move'] for item in turns} == {'formula_reminder', 'invite_resubmit'}

    connection.execute('delete from math_mate.learners where id = %s', (owner,))
    assert connection.execute('select count(*) from math_mate.learning_events where learner_id = %s', (owner,)).fetchone()[0] == 0


def test_help_before_submitting_makes_the_attempt_assisted(client):
    http, connection = client
    headers = guest(http)
    owner = learner_id(connection, headers)
    assert turn(http, headers, 'How do I start?', 'hint').json()['status'] == 'completed'
    save(http, headers, PART, RIGHT)
    assess(http, headers, 1)
    assert connection.execute('''select a.independent from math_mate.assessments a
        join math_mate.response_submissions s on s.id = a.submission_id
        join math_mate.student_responses r on r.id = s.response_id where r.learner_id = %s''', (owner,)).fetchone()[0] is False


def test_retries_duplicates_and_concurrent_turns(client):
    http, connection = client
    headers = guest(http)
    client_id = uuid.uuid4()
    fake_provider().queue(ProviderTimeout())
    failed = turn(http, headers, 'I tried 5p = 1510', client_id=client_id)
    assert failed.status_code == 503
    saved = http.get('/api/v1/me/tutor-turns?topic_number=2', headers=headers).json()['turns'][0]
    assert saved['status'] == 'failed' and saved['can_retry'] and 'took too long' in saved['error_message']
    retried = turn(http, headers, 'I tried 5p = 1510', client_id=client_id)
    assert retried.status_code == 200 and retried.json()['id'] == saved['id']
    observers = calls(connection, 'observer')
    assert turn(http, headers, 'I tried 5p = 1510', client_id=client_id).json()['id'] == saved['id']
    assert calls(connection, 'observer') == observers

    connection.execute('''insert into math_mate.tutor_turns (session_id, learner_id, client_message_id, intent, learner_message)
        select id, learner_id, gen_random_uuid(), 'message', 'still thinking' from math_mate.tutor_sessions
        where learner_id = %s''', (learner_id(connection, headers),))
    assert turn(http, headers, 'another message').status_code == 409


def test_streamed_reply_arrives_in_events_and_is_saved(client):
    http, connection = client
    headers = guest(http)
    with http.stream(
            'POST', f'/api/v1/me/question-parts/{PART}/tutor-turns',
            headers={**headers, 'Accept': 'text/event-stream'},
            json={'client_message_id': str(uuid.uuid4()), 'message': 'Help me start', 'intent': 'hint'}) as response:
        assert response.headers['content-type'].startswith('text/event-stream')
        body = ''.join(response.iter_text())
    events = [(block.split('\n')[0][7:], json.loads(block.split('\n')[1][6:])) for block in body.strip().split('\n\n')]
    kinds = [kind for kind, _ in events]
    assert kinds[0] == 'start' and kinds[-1] == 'done' and 'delta' in kinds
    streamed = ''.join(data['text'] for kind, data in events if kind == 'delta')
    assert events[-1][1]['tutor_message'] == streamed.strip()
    assert http.get('/api/v1/me/tutor-turns?topic_number=2', headers=headers).json()['turns'][0]['status'] == 'completed'


def test_unavailable_ai_graph_parts_and_stale_jobs(client, monkeypatch):
    http, connection = client
    headers = guest(http)
    save(http, headers, PART, WRONG)
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'off')
    assert assess(http, headers, 1).status_code == 503
    assert turn(http, headers, 'hint please', 'hint').status_code == 503
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'fake')

    rows = connection.execute('''select p.id, q.question_data from math_mate.question_parts p
        join math_mate.questions q on q.id = p.question_id where p.active order by p.id''').fetchall()
    graph_part = next(part_id for part_id, question in rows if not build_part_context(question, part_id).ai_markable)
    save(http, headers, graph_part, 'my sketch')
    assert assess(http, headers, 1, graph_part).status_code == 422

    job = assess(http, headers, 1).json()
    connection.execute('''update math_mate.assessments set status = 'processing', result = null, marks_awarded = null,
        updated_at = now() - interval '10 minutes' where id = %s''', (job['id'],))
    stale = [item for item in assessments(http, headers) if item['id'] == job['id']][0]
    assert stale['status'] == 'failed' and stale['can_retry']
    assert assess(http, headers, 1).json()['id'] == job['id']
    assert [item for item in assessments(http, headers) if item['id'] == job['id']][0]['status'] == 'completed'


def test_budget_reservations_block_before_any_request(client, monkeypatch):
    _, connection = client
    monkeypatch.setenv('MATH_MATE_AI_DAILY_BUDGET_USD', '1000')
    request = LLMRequest('smoke', [], 8, 'smoke-test')
    call_id = gateway.ledger.reserve(request, 'deepseek', 'deepseek-flash', Decimal('0.002'))
    gateway.ledger.settle(call_id, 'ok', None, Decimal('0.001'), 10)
    assert connection.execute('select status, cost_usd from math_mate.llm_calls where id = %s', (call_id,)).fetchone() == ('ok', Decimal('0.001000'))
    spent = connection.execute("select sum(cost_usd) from math_mate.llm_calls where created_at >= date_trunc('day', now(), 'UTC')").fetchone()[0]
    monkeypatch.setenv('MATH_MATE_AI_DAILY_BUDGET_USD', str(spent + Decimal('0.001')))
    with pytest.raises(BudgetExceeded):
        gateway.ledger.reserve(request, 'deepseek', 'deepseek-flash', Decimal('0.002'))
    assert connection.execute("select count(*) from math_mate.llm_calls where status = 'budget_blocked' and purpose = 'smoke'").fetchone()[0] >= 1
