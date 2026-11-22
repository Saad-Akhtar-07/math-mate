"""Validated request bodies for editable work and submitted attempts."""

import json

from pydantic import BaseModel, ConfigDict, Field, field_validator


def validate_visual_answer(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('visual_answer must be an object')
    if value.get('version') != 'visual-answer-v1':
        raise ValueError('visual_answer.version must be visual-answer-v1')
    if value.get('primary_source') not in ('canvas', 'photo'):
        raise ValueError('visual_answer.primary_source must be canvas or photo')
    objects = value.get('objects')
    if not isinstance(objects, list) or len(objects) > 120:
        raise ValueError('visual_answer.objects must be a list of at most 120 items')
    if value.get('primary_source') == 'photo' and objects:
        raise ValueError('photo visual answers cannot also contain canvas objects')
    if len(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) > 100_000:
        raise ValueError('visual_answer is too large')
    return value


class SaveDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    typed_work: str = Field(max_length=20000, strict=True)
    visual_answer: dict | None = None
    expected_revision: int = Field(ge=0, strict=True)

    _visual_answer = field_validator('visual_answer')(validate_visual_answer)


class SubmitDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(gt=0, strict=True)
