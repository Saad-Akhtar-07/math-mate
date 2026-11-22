"""Tutor turn endpoints. Send Accept: text/event-stream to receive the reply as it is written."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..dependencies import User
from ...schemas.tutoring import SendTutorTurn
from ...services import tutoring

router = APIRouter(prefix='/api/v1/me')


@router.post('/question-parts/{part_id}/tutor-turns')
def send_turn(part_id: str, body: SendTutorTurn, owner: User, request: Request):
    plan = tutoring.start_turn(part_id, body, owner)
    if isinstance(plan, dict):
        return plan
    if 'text/event-stream' in request.headers.get('accept', ''):
        return StreamingResponse(tutoring.stream_turn(plan), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
    return tutoring.complete_turn(plan)


@router.get('/tutor-turns')
def list_turns(owner: User, topic_number: str = Query(max_length=20)):
    return tutoring.list_turns(owner, topic_number)
