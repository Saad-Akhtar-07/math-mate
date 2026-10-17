import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

from backend.app.services.storage import Storage, StorageError
from backend.app.middleware.upload_limits import UploadBodyLimit


@pytest.fixture
def storage(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://storage.example.test')
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'sb_secret_test')
    monkeypatch.setenv('MATH_MATE_STORAGE_BUCKET', 'test-solutions')
    return Storage()


def test_new_secret_uses_apikey_header_and_missing_bucket_can_be_created(storage, monkeypatch):
    requests = []
    real_client = httpx.Client
    def handle(request):
        requests.append(request)
        assert request.headers['apikey'] == 'sb_secret_test'
        assert 'authorization' not in request.headers
        if request.method == 'GET':
            return httpx.Response(400, json={'statusCode': '404', 'message': 'Bucket not found'})
        body = json.loads(request.content)
        assert body['public'] is False
        assert body['allowed_mime_types'] == ['image/jpeg']
        assert body['file_size_limit'] == 5242880
        return httpx.Response(200, json={'name': 'test-solutions'})
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    storage.ensure_bucket(create=True)
    assert len(requests) == 2


def test_public_bucket_is_rejected_and_signed_urls_are_short_lived(storage, monkeypatch):
    monkeypatch.setattr(storage, 'request', lambda *args, **kwargs: httpx.Response(200, json={'public': True}))
    with pytest.raises(StorageError, match='must be private'):
        storage.signed_url('test-solutions', 'page.jpg')
    def request(method, path, **kwargs):
        if method == 'GET':
            return httpx.Response(200, json={'public': False})
        assert kwargs['json'] == {'expiresIn': 900}
        return httpx.Response(200, json={'signedURL': '/object/sign/test-solutions/page.jpg?token=temporary'})
    monkeypatch.setattr(storage, 'request', request)
    assert storage.signed_url('test-solutions', 'page.jpg') == 'https://storage.example.test/storage/v1/object/sign/test-solutions/page.jpg?token=temporary'


def test_storage_transport_errors_do_not_expose_credentials(storage, monkeypatch):
    real_client = httpx.Client
    def fail(_request):
        raise httpx.ConnectError('Underlying error with sb_secret_test')
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(fail), **kwargs))
    with pytest.raises(StorageError) as caught:
        storage.request('GET', '/bucket/test-solutions')
    assert 'sb_secret_test' not in str(caught.value)


def test_body_limit_rejects_declared_and_streamed_oversize_uploads():
    async def scenario(declared):
        output = []
        async def app(scope, receive, send):
            while True:
                item = await receive()
                if not item.get('more_body'):
                    break
        chunks = iter([{'type': 'http.request', 'body': b'x' * (6 * 1024 * 1024), 'more_body': True}] * 2)
        async def receive():
            return next(chunks)
        async def send(message):
            output.append(message)
        scope = {'type': 'http', 'method': 'POST', 'path': '/api/v1/me/responses/part/attachments',
                 'headers': [(b'content-length', b'20000000')] if declared else []}
        middleware = UploadBodyLimit(app)
        if declared:
            await middleware(scope, receive, send)
            assert output[0]['status'] == 413
        else:
            with pytest.raises(HTTPException) as caught:
                await middleware(scope, receive, send)
            assert caught.value.status_code == 413
    asyncio.run(scenario(True))
    asyncio.run(scenario(False))
