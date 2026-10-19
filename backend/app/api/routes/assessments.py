"""AI marking endpoints.

By default marking runs after the response is sent and the client polls the list.
With ?wait=true the request marks inline and returns 200 with the finished result,
or 202 if the job is still running elsewhere.
"""

from fastapi import APIRouter, BackgroundTasks, Query, Response

from ..dependencies import Learner
from ...schemas.tutoring import RequestAssessment
from ...services import assessments

router = APIRouter(prefix='/api/v1/me')


@router.post('/responses/{part_id}/assessments', status_code=202)
def request_assessment(part_id: str, body: RequestAssessment, owner: Learner, background: BackgroundTasks,
                       response: Response, wait: bool = Query(False)):
    result = assessments.request_assessment(part_id, body, owner, background.add_task, wait)
    if result['status'] not in ('pending', 'processing'):
        response.status_code = 200
    return result


@router.get('/assessments')
def list_assessments(owner: Learner, topic_number: str = Query(max_length=20)):
    return assessments.list_assessments(owner, topic_number)
