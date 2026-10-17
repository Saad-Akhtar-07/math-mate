"""Database integration checks. All test learner records are rolled back."""

import os
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from backend.app import main as api
from backend.app.api import dependencies
from backend.app.services import responses as submissions, uploads, storage_cleanup as cleanup_storage
from backend.app.services import questions, sessions
from backend.app.db.connection import connect
from backend.app.core.config import PROJECT_ROOT

pytestmark = pytest.mark.skipif(os.getenv('MATH_MATE_TEST_DB') != '1', reason='Set MATH_MATE_TEST_DB=1 for rollback-only database tests')


@pytest.fixture
def client(monkeypatch):
    with connect() as connection, connection.transaction(force_rollback=True):
        if connection.execute("select to_regclass('math_mate.student_responses')").fetchone()[0] is None:
            migration = PROJECT_ROOT / 'supabase/migrations/20261016000000_learner_solutions.sql'
            connection.execute(migration.read_text(encoding='utf-8'))
        if connection.execute("select to_regclass('math_mate.solution_files')").fetchone()[0] is None:
            migration = PROJECT_ROOT / 'supabase/migrations/20261016010000_solution_images.sql'
            connection.execute(migration.read_text(encoding='utf-8'))
        @contextmanager
        def request_connection():
            # A failed request rolls back its own savepoint, as in production.
            with connection.transaction():
                yield connection
        for module in (dependencies, questions, sessions):
            monkeypatch.setattr(module, 'connect', request_connection)
        monkeypatch.setattr(submissions, 'connect', request_connection)
        monkeypatch.setattr(uploads, 'connect', request_connection)
        monkeypatch.setattr(cleanup_storage, 'connect', request_connection)
        yield TestClient(api.app), connection


def guest(client):
    response = client.post('/api/v1/learner-sessions')
    assert response.status_code == 201
    assert response.headers['cache-control'] == 'no-store'
    return {'Authorization': f"Bearer {response.json()['access_token']}"}


def part(connection):
    return connection.execute('select id from math_mate.question_parts where active order by id limit 1').fetchone()[0]


def save(client, headers, part_id, text, revision=0):
    return client.put(f'/api/v1/me/responses/{part_id}', headers=headers,
                      json={'typed_work': text, 'expected_revision': revision})


def test_guest_isolation_and_tokens_not_stored(client):
    http, connection = client
    first, second = guest(http), guest(http)
    part_id = part(connection)
    saved = save(http, first, part_id, '2x = 10; x = 5')
    assert saved.status_code == 200
    restored = http.get(f'/api/v1/me/responses/{part_id}', headers=first)
    assert restored.status_code == 200
    assert restored.headers['cache-control'] == 'no-store'
    assert restored.json()['typed_work'] == '2x = 10; x = 5'
    assert http.get(f'/api/v1/me/responses/{part_id}', headers=second).status_code == 404
    assert http.get(f'/api/v1/me/responses/{part_id}').status_code == 401
    assert http.get('/api/v1/me/responses?topic_number=2', headers=second).json()['responses'] == []
    assert http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=second,
                     json={'expected_revision': 1}).status_code == 404
    assert http.get(f'/api/v1/me/responses/{part_id}/submissions', headers=second).json()['submissions'] == []
    hashes = connection.execute('select token_hash from math_mate.learner_sessions').fetchall()
    assert all(len(row[0]) == 64 and row[0] != first['Authorization'][7:] for row in hashes)
    assert http.get('/api/v1/me/responses?topic_number=2').status_code == 401
    assert http.get('/api/v1/me/responses?topic_number=2', headers={'Authorization': 'Bearer invalid'}).status_code == 401


def test_conflicts_retries_and_submission_history(client):
    http, connection = client
    headers, part_id = guest(http), part(connection)
    first = save(http, headers, part_id, 'First method').json()
    assert first['revision'] == 1
    assert save(http, headers, part_id, 'First method').json()['revision'] == 1
    assert save(http, headers, part_id, 'Stale overwrite', 0).status_code == 409
    submitted = http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=headers,
                          json={'expected_revision': 1}).json()
    assert submitted['typed_work'] == 'First method'
    def contains_mark_scheme(value):
        if isinstance(value, dict):
            return 'mark_scheme' in value or any(contains_mark_scheme(child) for child in value.values())
        if isinstance(value, list):
            return any(contains_mark_scheme(child) for child in value)
        return False
    assert not contains_mark_scheme(submitted['question_snapshot'])
    assert save(http, headers, part_id, 'First method', 1).json()['submitted'] is True
    second = save(http, headers, part_id, 'Second method', 1).json()
    assert second['revision'] == 2 and second['submitted'] is False
    retry = http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=headers,
                      json={'expected_revision': 1}).json()
    assert retry['id'] == submitted['id']
    assert save(http, headers, part_id, 'Overwrite from old tab', 1).status_code == 409
    newer = http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=headers,
                      json={'expected_revision': 2})
    assert newer.status_code == 200
    history = http.get(f'/api/v1/me/responses/{part_id}/submissions?limit=1', headers=headers).json()
    assert history['submissions'][0]['typed_work'] == 'Second method'
    earlier = http.get(f"/api/v1/me/responses/{part_id}/submissions?before={history['next_cursor']}", headers=headers).json()
    assert earlier['submissions'][0]['typed_work'] == 'First method'


def test_validation_expiration_and_unknown_parts(client):
    http, connection = client
    headers, part_id = guest(http), part(connection)
    assert save(http, headers, 'missing-part', 'x').status_code == 404
    assert save(http, headers, part_id, 'x' * 20001).status_code == 422
    assert save(http, headers, part_id, '   ').status_code == 200
    assert http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=headers,
                     json={'expected_revision': 1}).status_code == 422
    connection.execute("update math_mate.learner_sessions set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'")
    assert http.get('/api/v1/me/responses?topic_number=2', headers=headers).status_code == 401


def test_question_projection_and_foreign_keys(client):
    from psycopg.errors import ForeignKeyViolation
    http, connection = client
    part_id = part(connection)
    headers = guest(http)
    save(http, headers, part_id, 'Retain this work')
    with pytest.raises(ForeignKeyViolation), connection.transaction():
        connection.execute('delete from math_mate.question_parts where id = %s', (part_id,))
    # Removing a leaf from reviewed JSON retires its key rather than orphaning work.
    question_id = connection.execute('select question_id from math_mate.question_parts where id = %s', (part_id,)).fetchone()[0]
    connection.execute('''update math_mate.questions set question_data = jsonb_build_object('id', id, 'parts',
        jsonb_build_array(jsonb_build_object('id', id || '-replacement'))) where id = %s''', (question_id,))
    assert connection.execute('select active from math_mate.question_parts where id = %s', (part_id,)).fetchone()[0] is False
    assert save(http, headers, part_id, 'Retired overwrite', 1).status_code == 404
    assert connection.execute('select typed_work from math_mate.student_responses where question_part_id = %s', (part_id,)).fetchone()[0] == 'Retain this work'


def test_draft_pagination(client):
    http, connection = client
    headers = guest(http)
    part_ids = [row[0] for row in connection.execute('''select p.id from math_mate.question_parts p
        join math_mate.questions q on q.id = p.question_id where p.active and q.topic_code = '2'
        order by p.id limit 3''').fetchall()]
    for part_id in part_ids:
        assert save(http, headers, part_id, 'Work').status_code == 200
    first = http.get('/api/v1/me/responses?topic_number=2&limit=2', headers=headers).json()
    second = http.get(f"/api/v1/me/responses?topic_number=2&limit=2&after={first['next_cursor']}", headers=headers).json()
    assert len(first['responses']) == 2 and len(second['responses']) == 1
    assert second['next_cursor'] is None


def test_no_ai_and_configuration_controls_upload_capabilities(client):
    from backend.app.core.config import storage_configured
    http, _ = client
    question = http.get('/api/v1/topics/2/questions').json()['questions'][0]
    assert question['localDraftOnly'] is False
    assert question['capabilities'] == {'saveResponses': True, 'submitResponses': True, 'uploads': storage_configured(), 'aiTutor': False}
    assert question['uploadLimits']['maxPages'] == 4


@pytest.fixture
def fake_storage(monkeypatch):
    class FakeStorage:
        bucket = 'test-private-solutions'
        objects = {}
        writes = 0
        fail = False
        def put(self, key, data):
            from backend.app.services.storage import StorageError
            if self.fail:
                raise StorageError('Storage temporarily unavailable')
            type(self).writes += 1
            self.objects[key] = data
        def signed_url(self, bucket, key):
            return 'https://storage.example.test/private-image'
        def delete(self, bucket, key):
            self.objects.pop(key, None)
    monkeypatch.setattr(uploads, 'Storage', FakeStorage)
    monkeypatch.setattr(cleanup_storage, 'Storage', FakeStorage)
    return FakeStorage


def photo(color):
    import io
    from PIL import Image
    buffer = io.BytesIO()
    Image.new('RGB', (100, 160), color).save(buffer, format='PNG')
    return buffer.getvalue()


def upload(http, headers, part_id, raw, revision):
    return http.post(f'/api/v1/me/responses/{part_id}/attachments', headers=headers,
        data={'expected_revision': str(revision)}, files={'image': ('page.png', raw, 'image/png')})


def test_four_separate_pages_retries_and_owner_isolation(client, fake_storage):
    import hashlib
    http, connection = client
    headers, part_id = guest(http), part(connection)
    draft = save(http, headers, part_id, '').json()
    for color in ('white', 'black', 'red', 'blue'):
        result = upload(http, headers, part_id, photo(color), draft['revision'])
        assert result.status_code == 200, result.text
        draft = result.json()
    assert len(draft['attachments']) == 4
    restored = http.get(f'/api/v1/me/responses/{part_id}', headers=headers).json()
    assert restored['revision'] == draft['revision']
    assert restored['attachments'] == draft['attachments']
    assert restored['attachments'][0]['upload_sha256'] == hashlib.sha256(photo('white')).hexdigest()
    assert fake_storage.writes == 4 and len(fake_storage.objects) == 4
    duplicate = upload(http, headers, part_id, photo('white'), 1)
    assert duplicate.status_code == 200 and duplicate.json()['revision'] == draft['revision']
    assert fake_storage.writes == 4
    assert upload(http, headers, part_id, photo('green'), draft['revision']).status_code == 422
    file_id = draft['attachments'][0]['file_id']
    other = guest(http)
    assert http.get(f'/api/v1/me/solution-files/{file_id}/url', headers=other).status_code == 404
    assert http.get(f'/api/v1/me/solution-files/{file_id}/url', headers=headers).status_code == 200


def test_image_only_submission_keeps_pages_after_draft_removal(client, fake_storage):
    http, connection = client
    headers, part_id = guest(http), part(connection)
    save(http, headers, part_id, '')
    draft = upload(http, headers, part_id, photo('white'), 1).json()
    submitted = http.post(f'/api/v1/me/responses/{part_id}/submissions', headers=headers,
        json={'expected_revision': draft['revision']})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()['typed_work'] == '' and len(submitted.json()['attachments']) == 1
    attachment = draft['attachments'][0]
    removed = http.delete(f"/api/v1/me/responses/{part_id}/attachments/{attachment['id']}?expected_revision={draft['revision']}", headers=headers)
    assert removed.status_code == 200 and removed.json()['attachments'] == []
    history = http.get(f'/api/v1/me/responses/{part_id}/submissions', headers=headers).json()
    assert history['submissions'][0]['attachments'][0]['file_id'] == attachment['file_id']
    connection.execute("update math_mate.solution_files set updated_at = now() - interval '2 days'")
    assert cleanup_storage.cleanup(apply=True) == 0
    assert len(fake_storage.objects) == 1


def test_failed_upload_has_no_draft_page_and_can_retry_then_cleanup(client, fake_storage):
    http, connection = client
    headers, part_id = guest(http), part(connection)
    save(http, headers, part_id, 'My method')
    fake_storage.fail = True
    assert upload(http, headers, part_id, photo('white'), 1).status_code == 503
    restored = http.get('/api/v1/me/responses?topic_number=2', headers=headers).json()['responses'][0]
    assert restored['revision'] == 1 and restored['attachments'] == []
    fake_storage.fail = False
    draft = upload(http, headers, part_id, photo('white'), 1).json()
    assert len(draft['attachments']) == 1
    assert upload(http, headers, part_id, photo('black'), 1).status_code == 409
    attachment = draft['attachments'][0]
    http.delete(f"/api/v1/me/responses/{part_id}/attachments/{attachment['id']}?expected_revision={draft['revision']}", headers=headers)
    assert cleanup_storage.cleanup(apply=True) == 0
    connection.execute("update math_mate.solution_files set updated_at = now() - interval '2 days'")
    assert cleanup_storage.cleanup(apply=True) == 1
    assert not fake_storage.objects
