"""Guest-session creation endpoint."""

from fastapi import APIRouter, Response

from ..dependencies import private_response
from ...services import sessions

router = APIRouter(prefix='/api/v1')


@router.post('/learner-sessions', status_code=201)
def create_session(response: Response):
    private_response(response)
    return sessions.create_session()
