"""DeepSeek request and response handling against httpx.MockTransport. No real requests."""

import json

import httpx
import pytest

from backend.app.ai.providers.deepseek import DeepSeekProvider
from backend.app.ai.types import LLMRequest, ProviderRejected, ProviderTimeout, ProviderUnavailable
from backend.app.core.config import ai_settings


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setenv('MATH_MATE_AI_PROVIDER', 'deepseek')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-key')
    monkeypatch.setenv('DEEPSEEK_BASE_URL', 'https://deepseek.example.test')
    return ai_settings()


def provider(settings, handler):
    return DeepSeekProvider(settings, transport=httpx.MockTransport(handler))


def completion(content='{"ok": true}', finish='stop'):
    return httpx.Response(200, json={
        'choices': [{'message': {'content': content, 'reasoning_content': 'hidden'}, 'finish_reason': finish}],
        'usage': {'prompt_cache_hit_tokens': 10, 'prompt_cache_miss_tokens': 90, 'completion_tokens': 40,
                  'completion_tokens_details': {'reasoning_tokens': 25}},
    })


def test_non_thinking_json_request_shape(settings):
    seen = []
    def handle(request):
        seen.append(request)
        return completion()
    request = LLMRequest('observer', [{'role': 'user', 'content': 'Return JSON.'}], 200, 'observer-v')
    result = provider(settings, handle).complete(request)
    body = json.loads(seen[0].content)
    assert str(seen[0].url) == 'https://deepseek.example.test/chat/completions'
    assert seen[0].headers['authorization'] == 'Bearer test-key'
    assert body == {'model': 'deepseek-flash', 'messages': request.messages, 'max_tokens': 200,
                    'thinking': {'type': 'disabled'}, 'response_format': {'type': 'json_object'}}
    assert result.content == '{"ok": true}'
    assert (result.usage.cache_hit, result.usage.cache_miss, result.usage.completion, result.usage.reasoning) == (10, 90, 40, 25)


def test_thinking_request_includes_effort(settings):
    seen = []
    def handle(request):
        seen.append(json.loads(request.content))
        return completion()
    provider(settings, handle).complete(LLMRequest('marker', [], 512, 'm', thinking=True, reasoning_effort='low'))
    assert seen[0]['thinking'] == {'type': 'enabled'} and seen[0]['reasoning_effort'] == 'low'


@pytest.mark.parametrize(('response', 'error'), [
    (httpx.Response(500), ProviderUnavailable), (httpx.Response(429), ProviderUnavailable),
    (httpx.Response(400, json={'error': {'message': 'bad'}}), ProviderRejected),
    (httpx.Response(200, json={'unexpected': True}), ProviderUnavailable),
])
def test_http_errors_are_typed(settings, response, error):
    with pytest.raises(error):
        provider(settings, lambda _request: response).complete(LLMRequest('smoke', [], 8, 's'))


def test_timeout_is_typed(settings):
    def handle(request):
        raise httpx.ReadTimeout('slow', request=request)
    with pytest.raises(ProviderTimeout):
        provider(settings, handle).complete(LLMRequest('smoke', [], 8, 's'))


def test_stream_yields_deltas_then_usage(settings):
    seen = []
    def handle(request):
        seen.append(json.loads(request.content))
        lines = [
            {'choices': [{'delta': {'content': 'Try '}, 'finish_reason': None}], 'usage': None},
            {'choices': [{'delta': {'content': 'again.'}, 'finish_reason': None}], 'usage': None},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}],
             'usage': {'prompt_cache_hit_tokens': 5, 'prompt_cache_miss_tokens': 5, 'completion_tokens': 3}},
        ]
        body = ''.join(f'data: {json.dumps(line)}\n\n' for line in lines) + 'data: [DONE]\n\n'
        return httpx.Response(200, content=body.encode(), headers={'content-type': 'text/event-stream'})
    events = list(provider(settings, handle).stream(LLMRequest('composer', [], 100, 'c', json_output=False)))
    assert seen[0]['stream'] is True and seen[0]['stream_options'] == {'include_usage': True}
    assert 'response_format' not in seen[0]
    assert [event[1] for event in events[:2]] == ['Try ', 'again.']
    assert events[-1][0] == 'done' and events[-1][1] == 'stop' and events[-1][2].completion == 3


def test_real_transport_refused_under_pytest(settings):
    with pytest.raises(ProviderRejected):
        DeepSeekProvider(settings)
