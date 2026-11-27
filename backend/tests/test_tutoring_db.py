"""End-to-end marking, tutoring and memory with the fake provider. Everything is rolled back.

Requires MATH_MATE_TEST_DB=1 (see the `client` fixture in conftest.py). No paid AI requests are made.
"""

import json
import uuid
from decimal import Decimal

import pytest
from psycopg.rows import dict_row

from backend.app.ai import gateway
from backend.app.ai.providers import fake_provider
from backend.app.ai.types import BudgetExceeded, LLMRequest, ProviderTimeout
from backend.app.services import assessments as assessment_service, learning, uploads
from backend.app.tutoring.part_context import build_part_context
from helpers import save, user, user_id

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


@pytest.fixture
def visual_storage(monkeypatch):
    class FakeStorage:
        bucket = 'test-private-solutions'
        objects = {}
        def put(self, key, data):
            type(self).objects[key] = data
        def get(self, bucket, key):
            return type(self).objects[key]
    FakeStorage.objects = {}
    monkeypatch.setattr(uploads, 'Storage', FakeStorage)
    monkeypatch.setattr(assessment_service, 'Storage', FakeStorage)
    return FakeStorage


def visual_photo(color):
    import io
    from PIL import Image
    buffer = io.BytesIO()
    Image.new('RGB', (120, 180), color).save(buffer, format='PNG')
    return buffer.getvalue()


def calls(connection, purpose):
    return connection.execute('select count(*) from math_mate.llm_calls where purpose = %s', (purpose,)).fetchone()[0]


def test_mark_tutor_resubmit_and_remember(client):
    http, connection = client
    headers = user(http)
    owner = user_id(connection, headers)
    with connection.cursor(row_factory=dict_row) as cursor:
        assert learning.tutor_profile(cursor, owner, {'2.5.1'})['states'] == {}
    before = {purpose: calls(connection, purpose) for purpose in ('marker', 'observer', 'composer')}
    assert save(http, headers, PART, WRONG).status_code == 200

    first = assess(http, headers, 1)
    assert first.status_code == 202 and first.json()['status'] == 'pending' and first.json()['attempt_number'] == 1
    marked = assessments(http, headers)[0]
    assert (marked['status'], marked['outcome'], marked['marks_awarded'], marked['marks_maximum']) == ('completed', 'marked', 0, 3)
    assert marked['what_i_read'] == WRONG and '62' not in marked['feedback']
    assert marked['review'] == {'points': [], 'mistakes': [{'step': 'p = 302', 'type': 'method', 'marks_lost': []}]}
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
        where user_id = %s''', (owner,)).fetchall()
    assert session == [('resolved', 2, 2)]
    events = connection.execute('''select outcome_code, score, weight from math_mate.learning_events
        where user_id = %s and kind = 'attempt' ''', (owner,)).fetchall()
    assert sorted((code, float(score), float(weight)) for code, score, weight in events) == [
        ('2.5.1', 0.0, 1.0), ('2.5.1', 1.0, 0.5), ('2.5.2', 0.0, 1.0), ('2.5.2', 1.0, 0.5)]
    states = connection.execute('''select outcome_code, attempts, independent_full_marks from math_mate.user_outcome_state
        where user_id = %s order by outcome_code''', (owner,)).fetchall()
    assert states == [('2.5.1', 2, 0), ('2.5.2', 2, 0)]
    shadow = connection.execute('''select model_version, outcome_code, evidence_count
        from math_mate.bkt_states where user_id = %s order by model_version, outcome_code''', (owner,)).fetchall()
    assert shadow == [
        ('bkt-context-time-v1', '2.5.1', 2), ('bkt-context-time-v1', '2.5.2', 2),
        ('bkt-shadow-v1', '2.5.1', 1), ('bkt-shadow-v1', '2.5.2', 1)]
    predictions = connection.execute('''select bkt_model_version, outcome_code, observed_correct,
            weighted_prediction, weighted_evidence_count, bkt_evidence_count_before
        from math_mate.learner_model_predictions where user_id = %s
        order by bkt_model_version, outcome_code''', (owner,)).fetchall()
    assert [(version, code, correct, float(weighted), weighted_count, bkt_count)
            for version, code, correct, weighted, weighted_count, bkt_count in predictions] == [
        ('bkt-context-time-v1', '2.5.1', False, 0.5, 0, 0),
        ('bkt-context-time-v1', '2.5.2', False, 0.5, 0, 0),
        ('bkt-shadow-v1', '2.5.1', False, 0.5, 0, 0),
        ('bkt-shadow-v1', '2.5.2', False, 0.5, 0, 0)]
    updates = connection.execute('''select attempt_context, observation_used, count(*)
        from math_mate.bkt_updates where user_id = %s
        group by attempt_context, observation_used order by attempt_context''', (owner,)).fetchall()
    assert updates == [('assisted', True, 2), ('independent', True, 2)]
    with connection.cursor(row_factory=dict_row) as cursor:
        profile = learning.tutor_profile(cursor, owner, {'2.5.1'})
    active = profile['states']['2.5.1']
    contextual_mastery = float(connection.execute('''select mastery from math_mate.bkt_states
        where user_id = %s and outcome_code = '2.5.1' and model_version = 'bkt-context-time-v1' ''',
        (owner,)).fetchone()[0])
    weighted_mastery = float(connection.execute('''select mastery from math_mate.user_outcome_state
        where user_id = %s and outcome_code = '2.5.1' ''', (owner,)).fetchone()[0])
    assert active['mastery'] == pytest.approx(contextual_mastery)
    assert active['mastery'] != weighted_mastery
    assert active['confidence'] == 0.5 and active['attempts'] == 2
    connection.execute('''update math_mate.bkt_states set last_evidence_at = now() - interval '61 days'
        where user_id = %s and outcome_code = '2.5.1' and model_version = 'bkt-context-time-v1' ''', (owner,))
    with connection.cursor(row_factory=dict_row) as cursor:
        forgotten = learning.tutor_profile(cursor, owner, {'2.5.1'})['states']['2.5.1']
    assert forgotten['mastery'] == pytest.approx(contextual_mastery * 0.9, abs=1e-6)
    # Two Marker calls, one Observer call for the typed message, one Composer call for the hint.
    assert {purpose: calls(connection, purpose) - before[purpose] for purpose in before} == {'marker': 2, 'observer': 1, 'composer': 1}

    other = user(http)
    assert assessments(http, other) == []
    assert http.get('/api/v1/me/tutor-turns?topic_number=2', headers=other).json()['turns'] == []
    turns = http.get('/api/v1/me/tutor-turns?topic_number=2', headers=headers).json()['turns']
    assert {item['teaching_move'] for item in turns} == {'formula_reminder', 'invite_resubmit'}

    connection.execute('delete from math_mate.users where id = %s', (owner,))
    assert connection.execute('select count(*) from math_mate.learning_events where user_id = %s', (owner,)).fetchone()[0] == 0


def test_help_before_submitting_makes_the_attempt_assisted(client):
    http, connection = client
    headers = user(http)
    owner = user_id(connection, headers)
    assert turn(http, headers, 'How do I start?', 'hint').json()['status'] == 'completed'
    save(http, headers, PART, RIGHT)
    assess(http, headers, 1)
    assert connection.execute('''select a.independent from math_mate.assessments a
        join math_mate.response_submissions s on s.id = a.submission_id
        join math_mate.student_responses r on r.id = s.response_id where r.user_id = %s''', (owner,)).fetchone()[0] is False
    assert connection.execute('''select distinct attempt_context from math_mate.bkt_updates
        where user_id = %s''', (owner,)).fetchall() == [('assisted',)]
    assert connection.execute('''select count(*) from math_mate.learner_model_predictions
        where user_id = %s''', (owner,)).fetchone()[0] == 0


def test_work_after_a_shown_solution_updates_learning_but_not_correctness_evidence(client):
    http, connection = client
    headers = user(http)
    owner = user_id(connection, headers)
    save(http, headers, PART, WRONG)
    assess(http, headers, 1)
    connection.execute('''update math_mate.tutor_sessions set solution_shown = true
        where user_id = %s and question_part_id = %s and state = 'active' ''', (owner, PART))
    connection.execute('''insert into math_mate.tutor_turns
        (session_id, user_id, client_message_id, intent, learner_message, teaching_move,
         assistance, tutor_message, status, completed_at)
        select id, user_id, gen_random_uuid(), 'message', 'Please show the solution', 'full_solution',
            5, 'A complete solution was shown.', 'completed', now()
        from math_mate.tutor_sessions
        where user_id = %s and question_part_id = %s and state = 'active' ''', (owner, PART))
    revision = save(http, headers, PART, RIGHT, 1).json()['revision']
    assess(http, headers, revision)

    updates = connection.execute('''select outcome_code, observed_correct, observation_used,
            mastery_after_forgetting, mastery_after_observation, mastery_after
        from math_mate.bkt_updates
        where user_id = %s and attempt_context = 'after_solution' order by outcome_code''', (owner,)).fetchall()
    assert len(updates) == 2
    for _, observed_correct, observation_used, after_forgetting, after_observation, mastery_after in updates:
        assert observed_correct is True
        assert observation_used is False
        assert after_observation == after_forgetting
        assert mastery_after > after_observation
    with connection.cursor(row_factory=dict_row) as cursor:
        profile = learning.tutor_profile(cursor, owner, {'2.5.1'})
    assert profile['states']['2.5.1']['confidence'] == 0.333


def test_retries_duplicates_and_concurrent_turns(client):
    http, connection = client
    headers = user(http)
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

    connection.execute('''insert into math_mate.tutor_turns (session_id, user_id, client_message_id, intent, learner_message)
        select id, user_id, gen_random_uuid(), 'message', 'still thinking' from math_mate.tutor_sessions
        where user_id = %s''', (user_id(connection, headers),))
    assert turn(http, headers, 'another message').status_code == 409


def test_streamed_reply_arrives_in_events_and_is_saved(client):
    http, connection = client
    headers = user(http)
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
    headers = user(http)
    save(http, headers, PART, WRONG)
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'off')
    assert assess(http, headers, 1).status_code == 503
    assert turn(http, headers, 'hint please', 'hint').status_code == 503
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'fake')

    rows = connection.execute('''select p.id, q.question_data from math_mate.question_parts p
        join math_mate.questions q on q.id = p.question_id where p.active order by p.id''').fetchall()
    graph_part = next(part_id for part_id, question in rows if build_part_context(question, part_id).visual_response)
    save(http, headers, graph_part, 'my sketch')
    assert assess(http, headers, 1, graph_part).status_code == 422

    job = assess(http, headers, 1).json()
    connection.execute('''update math_mate.assessments set status = 'processing', result = null, marks_awarded = null,
        updated_at = now() - interval '10 minutes' where id = %s''', (job['id'],))
    stale = [item for item in assessments(http, headers) if item['id'] == job['id']][0]
    assert stale['status'] == 'failed' and stale['can_retry']
    assert assess(http, headers, 1).json()['id'] == job['id']
    assert [item for item in assessments(http, headers) if item['id'] == job['id']][0]['status'] == 'completed'


def test_primary_photo_marks_once_and_unreadable_replacement_adds_no_evidence(client, visual_storage):
    http, connection = client
    headers = user(http)
    owner = user_id(connection, headers)
    rows = connection.execute('''select p.id, q.question_data from math_mate.question_parts p
        join math_mate.questions q on q.id = p.question_id
        where p.active and q.topic_code = '2' order by p.id''').fetchall()
    part_id, question = next((part_id, question) for part_id, question in rows
                             if build_part_context(question, part_id).visual_response)
    context = build_part_context(question, part_id)
    visual = {'version': 'visual-answer-v1', 'primary_source': 'photo', 'objects': []}
    saved = http.put(f'/api/v1/me/responses/{part_id}', headers=headers,
                     json={'typed_work': '', 'visual_answer': visual, 'expected_revision': 0})
    assert saved.status_code == 200
    stale = http.post(f'/api/v1/me/responses/{part_id}/attachments', headers=headers,
        data={'expected_revision': str(saved.json()['revision']), 'role': 'primary_visual', 'visual_source': 'canvas'},
        files={'image': ('old-canvas.png', visual_photo('black'), 'image/png')})
    assert stale.status_code == 200, stale.text
    mismatch = http.post(f'/api/v1/me/responses/{part_id}/assessments?wait=true', headers=headers,
                         json={'expected_revision': stale.json()['revision']})
    assert mismatch.status_code == 422

    uploaded = http.post(f'/api/v1/me/responses/{part_id}/attachments', headers=headers,
        data={'expected_revision': str(stale.json()['revision']), 'role': 'primary_visual', 'visual_source': 'photo'},
        files={'image': ('graph.png', visual_photo('white'), 'image/png')})
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()['attachments'][0]['visual_source'] == 'photo'

    decisions = [
        {'point_id': point.id, 'awarded': point.kind == 'visual_answer', 'reason': 'Visible in the primary image.',
         'evidence_refs': ['primary-image'], 'confidence': 'high'}
        for point in context.marking_points if point.id != 'P0'
    ]
    fake_provider().queue({'status': 'marked', 'what_i_read': 'A complete visual answer.',
                           'decisions': decisions, 'mistakes': [], 'feedback': 'Well done.', 'confidence': 'high'})
    marked = http.post(f'/api/v1/me/responses/{part_id}/assessments?wait=true', headers=headers,
                       json={'expected_revision': uploaded.json()['revision']})
    assert marked.status_code == 200, marked.text
    assert marked.json()['outcome'] == 'marked'
    assert marked.json()['marks_awarded'] == context.marks
    evidence_after_mark = connection.execute(
        'select count(*) from math_mate.learning_events where user_id = %s', (owner,)).fetchone()[0]
    assert evidence_after_mark > 0

    replacement = http.post(f'/api/v1/me/responses/{part_id}/attachments', headers=headers,
        data={'expected_revision': str(uploaded.json()['revision']), 'role': 'primary_visual', 'visual_source': 'photo'},
        files={'image': ('unclear.png', visual_photo('gray'), 'image/png')})
    assert replacement.status_code == 200, replacement.text
    fake_provider().queue({'status': 'unreadable', 'what_i_read': '', 'decisions': [], 'mistakes': [],
                           'feedback': '', 'confidence': 'low'})
    unreadable = http.post(f'/api/v1/me/responses/{part_id}/assessments?wait=true', headers=headers,
                           json={'expected_revision': replacement.json()['revision']})
    assert unreadable.status_code == 200, unreadable.text
    assert unreadable.json()['outcome'] == 'unreadable'
    assert unreadable.json()['marks_awarded'] is None
    assert 'Retake the photo' in unreadable.json()['feedback']
    assert connection.execute('select count(*) from math_mate.learning_events where user_id = %s',
                              (owner,)).fetchone()[0] == evidence_after_mark


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


def test_waiting_request_returns_the_finished_assessment(client):
    http, connection = client
    headers = user(http)
    save(http, headers, PART, WRONG)
    marked = http.post(f'/api/v1/me/responses/{PART}/assessments?wait=true', headers=headers, json={'expected_revision': 1})
    assert marked.status_code == 200
    body = marked.json()
    assert (body['status'], body['marks_awarded'], body['attempt_number']) == ('completed', 0, 1)
    assert assessments(http, headers)[0] == body
    # Asking again returns the same finished job without marking it twice.
    before = calls(connection, 'marker')
    again = http.post(f'/api/v1/me/responses/{PART}/assessments?wait=true', headers=headers, json={'expected_revision': 1})
    assert again.status_code == 200 and again.json()['id'] == body['id'] and calls(connection, 'marker') == before
