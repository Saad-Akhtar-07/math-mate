"""Validated shapes for every model output. Anything else is rejected."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra='ignore', str_strip_whitespace=True)


class PointDecision(Strict):
    point_id: str = Field(pattern=r'^P\d{1,3}$')
    awarded: bool
    reason: str = Field(default='', max_length=400)
    evidence_refs: list[str] = Field(default_factory=list, max_length=20)
    confidence: Literal['high', 'medium', 'low'] = 'medium'


class Mistake(Strict):
    student_step: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=400)
    type: Literal['conceptual', 'method', 'calculation', 'notation', 'reading']
    outcome_code: str = Field(max_length=20)
    misconception_id: str | None = Field(default=None, max_length=80)
    points_lost: list[str] = Field(default_factory=list, max_length=30)
    student_feature: str | None = Field(default=None, max_length=80)
    confidence: Literal['high', 'medium', 'low'] = 'medium'


class MarkerOutput(Strict):
    status: Literal['marked', 'unreadable', 'off_topic', 'needs_review']
    what_i_read: str = Field(default='', max_length=6000)
    decisions: list[PointDecision] = Field(default_factory=list, max_length=40)
    mistakes: list[Mistake] = Field(default_factory=list, max_length=10)
    feedback: str = Field(default='', max_length=800)
    confidence: Literal['high', 'medium', 'low'] = 'medium'


class Observation(Strict):
    intent: Literal['attempt', 'question', 'asks_for_answer', 'affirmation', 'off_topic']
    attempt_result: Literal['correct', 'partial', 'incorrect', 'none'] = 'none'
    affect: Literal['neutral', 'confused', 'frustrated'] = 'neutral'
    misconception_id: str | None = Field(default=None, max_length=80)
