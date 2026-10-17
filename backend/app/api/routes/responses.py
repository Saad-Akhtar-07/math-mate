"""Validate learner requests and delegate transactional response operations."""

from fastapi import APIRouter, Query

from ..dependencies import Learner
from ...schemas.responses import SaveDraft, SubmitDraft
from ...services import responses

router = APIRouter(prefix='/api/v1/me')


@router.get('/responses')
def list_responses(owner: Learner, topic_number: str = Query(max_length=20),
                   after: str = Query(default='', max_length=300), limit: int = Query(default=100, ge=1, le=100)):
    return responses.list_responses(owner, topic_number, after, limit)


@router.put('/responses/{part_id}')
def save_response(part_id: str, body: SaveDraft, owner: Learner):
    return responses.save_response(part_id, body, owner)


@router.get('/responses/{part_id}')
def get_response(part_id: str, owner: Learner):
    return responses.get_response(part_id, owner)


@router.post('/responses/{part_id}/submissions')
def submit_response(part_id: str, body: SubmitDraft, owner: Learner):
    return responses.submit_response(part_id, body, owner)


@router.get('/responses/{part_id}/submissions')
def list_submissions(part_id: str, owner: Learner, before: int | None = Query(default=None, gt=0),
                     limit: int = Query(default=20, ge=1, le=100)):
    return responses.list_submissions(part_id, owner, before, limit)
