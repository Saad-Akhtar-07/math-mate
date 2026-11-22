"""Validated request bodies for editable work and submitted attempts."""

from pydantic import BaseModel, ConfigDict, Field


class SaveDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    typed_work: str = Field(max_length=20000, strict=True)
    expected_revision: int = Field(ge=0, strict=True)


class SubmitDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(gt=0, strict=True)
