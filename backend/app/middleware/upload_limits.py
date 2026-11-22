"""Bound multipart upload bodies before an unlimited body can be spooled."""

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from ..services.image_processing import MAX_UPLOAD_BYTES


class UploadBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        limited = (scope['type'] == 'http' and scope.get('method') == 'POST'
                   and scope.get('path', '').startswith('/api/v1/me/responses/')
                   and scope.get('path', '').endswith('/attachments'))
        if not limited:
            return await self.app(scope, receive, send)
        maximum = MAX_UPLOAD_BYTES + 64 * 1024  # Form fields and multipart headers.
        headers = dict(scope.get('headers', []))
        try:
            declared = int(headers.get(b'content-length', b'0'))
        except ValueError:
            declared = 0
        if declared > maximum:
            return await JSONResponse({'detail': 'Each original image must be 10 MB or smaller.'}, status_code=413)(scope, receive, send)
        consumed = 0

        async def bounded_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get('body', b''))
            if consumed > maximum:
                raise HTTPException(413, 'Each original image must be 10 MB or smaller.')
            return message

        return await self.app(scope, bounded_receive, send)
