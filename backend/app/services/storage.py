"""Server-only private Supabase Storage access. Never log keys or signed URLs."""

import re
from urllib.parse import quote, urlparse

import httpx

from .image_processing import MAX_STORED_BYTES
from ..core.config import storage_settings


class StorageError(RuntimeError):
    pass


class Storage:
    def __init__(self):
        settings = storage_settings()
        self.url = settings['url']
        self.key = settings['key']
        self.bucket = settings['bucket']
        if not self.url or not self.key:
            raise StorageError('Image storage needs SUPABASE_URL and SUPABASE_SECRET_KEY on the backend.')
        if urlparse(self.url).scheme != 'https' or not urlparse(self.url).netloc:
            raise StorageError('SUPABASE_URL must be an HTTPS project URL.')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', self.bucket):
            raise StorageError('The storage bucket name is invalid.')

    def request(self, method, path, **kwargs):
        headers = {'apikey': self.key}
        # New sb_secret keys are gateway API keys, not JWT bearer tokens.
        if not self.key.startswith('sb_secret_'):
            headers['Authorization'] = f'Bearer {self.key}'
        headers.update(kwargs.pop('headers', {}))
        try:
            with httpx.Client(timeout=httpx.Timeout(30, connect=8)) as client:
                response = client.request(method, f'{self.url}/storage/v1{path}', headers=headers, **kwargs)
        except httpx.HTTPError:
            raise StorageError('Image storage could not be reached. Your typed work is still saved.') from None
        return response

    def ensure_bucket(self, create=False):
        response = self.request('GET', f'/bucket/{self.bucket}')
        # Storage can wrap a missing bucket's 404 in an HTTP 400 response.
        missing = response.status_code == 404
        if response.status_code == 400:
            try:
                missing = str(response.json().get('statusCode')) == '404'
            except ValueError:
                pass
        if missing and create:
            response = self.request('POST', '/bucket', json={
                'id': self.bucket, 'name': self.bucket, 'public': False,
                'file_size_limit': MAX_STORED_BYTES, 'allowed_mime_types': ['image/jpeg'],
            })
            if response.is_success:
                return
        if not response.is_success:
            if response.status_code in (401, 403):
                raise StorageError('Storage rejected its credentials. Check the backend SUPABASE_SECRET_KEY.')
            raise StorageError('Private image bucket is unavailable. Run python -m backend.scripts.setup_storage --apply after configuring storage credentials.')
        if response.json().get('public') is not False:
            raise StorageError('The solution image bucket must be private. Uploads are disabled until this is corrected.')

    def put(self, object_key, data):
        self.ensure_bucket()
        response = self.request('POST', f'/object/{self.bucket}/{quote(object_key, safe="/")}',
            content=data, headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'private, max-age=0'})
        if not response.is_success:
            raise StorageError('The image could not be stored. Check the storage quota and try again.')

    def signed_url(self, bucket, object_key):
        # Refuse to serve a bucket that has accidentally been made public.
        if bucket != self.bucket:
            raise StorageError('The image bucket does not match the configured bucket.')
        self.ensure_bucket()
        response = self.request('POST', f'/object/sign/{bucket}/{quote(object_key, safe="/")}', json={'expiresIn': 900})
        if not response.is_success:
            raise StorageError('The image could not be opened. Please try again.')
        path = response.json().get('signedURL')
        if not isinstance(path, str) or not path.startswith('/object/sign/'):
            raise StorageError('Image storage returned an invalid viewing link.')
        return f'{self.url}/storage/v1{path}'

    def delete(self, bucket, object_key):
        if bucket != self.bucket:
            raise StorageError('The image bucket does not match the configured bucket.')
        response = self.request('DELETE', f'/object/{bucket}', json={'prefixes': [object_key]})
        if not response.is_success:
            raise StorageError('An unused image could not be removed. Retry cleanup later.')
