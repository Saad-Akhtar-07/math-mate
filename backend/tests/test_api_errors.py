from uuid import UUID

from fastapi.testclient import TestClient

from backend.app.api.dependencies import learner
from backend.app.main import app
from backend.app.services import uploads
from backend.app.services.storage import StorageError


def test_storage_setup_details_stay_in_server_logs(monkeypatch, caplog):
    owner = UUID('11111111-1111-4111-8111-111111111111')
    monkeypatch.setitem(app.dependency_overrides, learner, lambda: owner)

    def unavailable(*_args):
        raise StorageError('Storage needs SUPABASE_SECRET_KEY configured on the backend.')

    monkeypatch.setattr(uploads, 'page_url', unavailable)
    response = TestClient(app).get('/api/v1/me/solution-files/22222222-2222-4222-8222-222222222222/url')

    assert response.status_code == 503
    assert response.headers['cache-control'] == 'no-store'
    assert 'SUPABASE_SECRET_KEY' not in response.text
    assert 'backend' not in response.text
    assert 'SUPABASE_SECRET_KEY' in caplog.text
