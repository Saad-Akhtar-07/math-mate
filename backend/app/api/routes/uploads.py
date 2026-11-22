"""Multipart request handling and owned page endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Form, Query, UploadFile

from ..dependencies import User
from ...services import uploads
from ...services.image_processing import MAX_UPLOAD_BYTES

router = APIRouter(prefix='/api/v1/me')


@router.post('/responses/{part_id}/attachments')
def upload_page(part_id: str, owner: User, image: UploadFile,
                expected_revision: Annotated[int, Form(gt=0)],
                role: Annotated[str, Form(pattern='^(primary_visual|supporting_work)$')] = 'supporting_work',
                visual_source: Annotated[str | None, Form(pattern='^(canvas|photo)$')] = None):
    try:
        raw = image.file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        image.file.close()
    return uploads.upload_page(part_id, owner, raw, image.filename, expected_revision, role, visual_source)


@router.delete('/responses/{part_id}/attachments/{attachment_id}')
def remove_page(part_id: str, attachment_id: UUID, owner: User, expected_revision: int = Query(gt=0)):
    return uploads.remove_page(part_id, attachment_id, owner, expected_revision)


@router.get('/solution-files/{file_id}/url')
def page_url(file_id: UUID, owner: User):
    return uploads.page_url(file_id, owner)
