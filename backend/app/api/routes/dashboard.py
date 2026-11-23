"""Private, compact dashboard projection."""

from fastapi import APIRouter, Query

from ..dependencies import User
from ...services import dashboard

router = APIRouter(prefix='/api/v1/me')


@router.get('/dashboard')
def progress(owner: User, topic_number: str = Query(max_length=20)):
    return dashboard.progress(owner, topic_number)
