"""Validated request bodies for AI marking and tutor turns."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RequestAssessment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(gt=0, strict=True)


class SendTutorTurn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    client_message_id: UUID
    message: str = Field(min_length=1, max_length=1000)
    intent: Literal['message', 'hint', 'explain', 'show_step'] = 'message'
