"""Shared request, result and error types for the model boundary."""

from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID


class AIError(Exception):
    code = 'provider_unavailable'
    ledger_status = 'provider_unavailable'
    user_message = 'The tutor is unavailable right now. Your work is saved; please try again.'


class AINotConfigured(AIError):
    code = 'rejected'
    ledger_status = 'rejected'
    user_message = 'The AI tutor is not available yet.'


class BudgetExceeded(AIError):
    code = 'budget'
    ledger_status = 'budget_blocked'
    user_message = 'The tutor is resting for today. Your work is saved; please try again tomorrow.'


class ProviderTimeout(AIError):
    code = 'timeout'
    ledger_status = 'timeout'
    user_message = 'The tutor took too long to respond. Your work is saved; please try again.'


class ProviderUnavailable(AIError):
    pass


class ProviderRejected(AIError):
    code = 'rejected'
    ledger_status = 'rejected'


class TruncatedOutput(AIError):
    code = 'truncated'
    ledger_status = 'truncated'


class InvalidOutput(AIError):
    code = 'invalid_output'
    ledger_status = 'invalid_output'


_EXTRA_MESSAGES = {
    'interrupted': 'This request was interrupted. Your work is saved; please try again.',
    'storage': 'A solution page could not be read for marking. Please try again.',
    'internal': 'Something went wrong on our side. Your work is saved; please try again.',
}


def user_message(code):
    """Student-safe text for a stored error code."""
    for error in (BudgetExceeded, ProviderTimeout, ProviderRejected, TruncatedOutput, InvalidOutput, AIError):
        if error.code == code:
            return error.user_message
    return _EXTRA_MESSAGES.get(code, AIError.user_message)


@dataclass(frozen=True)
class Usage:
    cache_hit: int = 0
    cache_miss: int = 0
    completion: int = 0
    reasoning: int = 0


@dataclass(frozen=True)
class LLMRequest:
    purpose: str                      # marker | observer | composer | smoke
    messages: list
    max_tokens: int
    prompt_version: str
    thinking: bool = False
    reasoning_effort: str | None = None
    json_output: bool = True
    learner_id: UUID | None = None    # budget accounting only; never sent to the provider
    source_id: UUID | None = None


@dataclass(frozen=True)
class RawCompletion:
    content: str
    finish_reason: str
    usage: Usage = field(default_factory=Usage)


@dataclass(frozen=True)
class LLMResult:
    content: str
    finish_reason: str
    usage: Usage
    cost_usd: Decimal
    latency_ms: int
    model: str
