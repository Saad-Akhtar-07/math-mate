"""Gateway, pricing and provider selection. All checks use the fake provider; no network."""

from decimal import Decimal

import pytest

from backend.app.ai import gateway, pricing
from backend.app.ai.providers import fake_provider, get_provider
from backend.app.ai.types import (AINotConfigured, InvalidOutput, LLMRequest, ProviderRejected, ProviderTimeout,
                                  RawCompletion, TruncatedOutput, Usage)


def request(purpose='smoke', json_output=True, thinking=False):
    return LLMRequest(purpose, [{'role': 'user', 'content': 'Return JSON.'}], 64, 'smoke-test',
                      thinking=thinking, json_output=json_output)


def test_fake_call_is_logged_without_network(ledger):
    result = gateway.call(request())
    assert result.content == '{"ok": true}'
    assert result.cost_usd == 0
    assert ledger.calls == [{'purpose': 'smoke', 'provider': 'fake', 'estimate': Decimal('0'), 'status': 'ok',
                             'usage': Usage(cache_miss=100, completion=50), 'cost': Decimal('0.000000')}]


def test_ai_is_off_by_default_even_with_a_key(monkeypatch, ledger):
    monkeypatch.delenv('MATH_MATE_AI_PROVIDER')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'configured-but-not-authorised')
    with pytest.raises(AINotConfigured):
        gateway.call(request())
    assert ledger.calls == []


def test_live_provider_refused_during_tests(monkeypatch, ledger):
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'deepseek')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-key')
    with pytest.raises(ProviderRejected):
        get_provider()
    with pytest.raises(ProviderRejected):
        gateway.call(request())
    assert ledger.calls == []


def test_truncated_invalid_and_failed_calls_are_settled(ledger):
    fake_provider().queue(RawCompletion('{"partial":', 'length', Usage(completion=64)), 'not json', ProviderTimeout())
    with pytest.raises(TruncatedOutput):
        gateway.call(request())
    with pytest.raises(InvalidOutput):
        gateway.call(request())
    with pytest.raises(ProviderTimeout):
        gateway.call(request())
    assert [call['status'] for call in ledger.calls] == ['truncated', 'invalid_output', 'timeout']
    # Unknown usage keeps the reserved estimate instead of recording zero.
    assert ledger.calls[2]['cost'] is None


def test_stream_settles_when_consumer_stops_early(ledger):
    fake_provider().queue('One. Two. Three.')
    chunks = gateway.stream(request(purpose='composer', json_output=False))
    assert next(chunks) == 'One. '
    chunks.close()
    assert ledger.calls[0]['status'] == 'ok'


def test_prices_and_worst_case_estimates():
    usage = Usage(cache_hit=1000, cache_miss=1000, completion=1000)
    assert pricing.cost('deepseek-flash', usage) == Decimal('0.001506')
    assert pricing.worst_case('deepseek-flash', 3000, 1024) == Decimal('0.002129')
    image = {'role': 'user', 'content': [{'type': 'text', 'text': 'abc' * 10}, {'type': 'image_url', 'image_url': {}}]}
    assert pricing.estimate_input_tokens([image]) == 11 + pricing.IMAGE_TOKEN_ESTIMATE
    with pytest.raises(ValueError):
        pricing.price('unpriced-model')
