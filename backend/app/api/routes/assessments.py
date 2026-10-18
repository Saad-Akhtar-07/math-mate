"""AI marking endpoints. Marking runs after the response is sent; the client polls the list."""

from fastapi import APIRouter, BackgroundTasks, Query

from ..dependencies import Learner
from ...schemas.tutoring import RequestAssessment
from ...services import assessments

router = APIRouter(prefix='/api/v1/me')


@router.post('/responses/{part_id}/assessments', status_code=202)
def request_assessment(part_id: str, body: RequestAssessment, owner: Learner, background: BackgroundTasks):
    return assessments.request_assessment(part_id, body, owner, background.add_task)


@router.get('/assessments')
def list_assessments(owner: Learner, topic_number: str = Query(max_length=20)):
    return assessments.list_assessments(owner, topic_number)
