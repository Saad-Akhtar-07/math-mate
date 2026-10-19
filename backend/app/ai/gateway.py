"""Single entry point for model calls: budget reservation, one request, usage ledger.

The gateway never retries. A call is reserved at its worst-case cost before the
request and settled with the reported usage afterwards, so a crash or timeout
leaves the conservative estimate in the ledger rather than an undercount.
"""

import json
import logging
import time

from ..core.config import ai_settings
from ..db.connection import connect
from . import pricing
from .providers import get_provider
from .types import AIError, BudgetExceeded, InvalidOutput, LLMRequest, LLMResult, ProviderUnavailable, TruncatedOutput

logger = logging.getLogger(__name__)


class DatabaseLedger:
    def reserve(self, request, provider, model, estimate):
        settings = ai_settings()
        # One round trip: the function takes the budget lock, sums today's spend and inserts the row.
        with connect(autocommit=True) as connection:
            call_id, blocked = connection.execute(
                'select call_id, blocked from math_mate.reserve_llm_call(%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                (request.purpose, provider, model, request.prompt_version, request.learner_id, request.source_id,
                 estimate, settings.daily_budget_usd, settings.learner_daily_budget_usd)).fetchone()
        if blocked:
            raise BudgetExceeded()
        return call_id

    def settle(self, call_id, status, usage, cost_usd, latency_ms):
        with connect(autocommit=True) as connection:
            connection.execute('''update math_mate.llm_calls set status = %s, cache_hit_tokens = %s,
                cache_miss_tokens = %s, completion_tokens = %s, reasoning_tokens = %s,
                cost_usd = coalesce(%s, cost_usd), latency_ms = %s where id = %s''',
                (status, usage.cache_hit if usage else 0, usage.cache_miss if usage else 0,
                 usage.completion if usage else 0, usage.reasoning if usage else 0,
                 cost_usd, latency_ms, call_id))


ledger = DatabaseLedger()


def _reserve(request, provider):
    reasoning = request.max_tokens if request.thinking else 0
    estimate = pricing.worst_case(provider.model, pricing.estimate_input_tokens(request.messages),
                                  request.max_tokens + reasoning)
    return ledger.reserve(request, provider.name, provider.model, estimate)


def _elapsed(started):
    return int((time.monotonic() - started) * 1000)


def call(request: LLMRequest) -> LLMResult:
    provider = get_provider()
    call_id = _reserve(request, provider)
    started = time.monotonic()
    try:
        raw = provider.complete(request)
    except AIError as error:
        # Unknown usage keeps the reserved worst-case cost.
        ledger.settle(call_id, error.ledger_status, None, None, _elapsed(started))
        raise
    except Exception as error:
        ledger.settle(call_id, 'provider_unavailable', None, None, _elapsed(started))
        logger.warning('Model request failed: %s', type(error).__name__)
        raise ProviderUnavailable() from None
    cost_usd = pricing.cost(provider.model, raw.usage)
    status = 'ok'
    if raw.finish_reason == 'length':
        status = 'truncated'
    elif request.json_output:
        try:
            json.loads(raw.content)
        except ValueError:
            status = 'invalid_output'
    ledger.settle(call_id, status, raw.usage, cost_usd, _elapsed(started))
    if status == 'truncated':
        raise TruncatedOutput()
    if status == 'invalid_output':
        raise InvalidOutput()
    return LLMResult(raw.content, raw.finish_reason, raw.usage, cost_usd, _elapsed(started), provider.model)


def stream(request: LLMRequest):
    """Yield text deltas. The ledger is settled even if the consumer stops early."""
    provider = get_provider()
    call_id = _reserve(request, provider)
    started = time.monotonic()
    usage, finish, status = None, None, 'ok'
    try:
        for kind, value, extra in provider.stream(request):
            if kind == 'delta':
                yield value
            else:
                finish, usage = value, extra
        if finish == 'length':
            status = 'truncated'
    except AIError as error:
        status = error.ledger_status
        raise
    except GeneratorExit:
        raise
    except Exception as error:
        status = 'provider_unavailable'
        logger.warning('Model stream failed: %s', type(error).__name__)
        raise ProviderUnavailable() from None
    finally:
        cost_usd = pricing.cost(provider.model, usage) if usage else None
        ledger.settle(call_id, status, usage, cost_usd, _elapsed(started))
