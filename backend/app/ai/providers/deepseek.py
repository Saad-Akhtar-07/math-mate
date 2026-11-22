"""DeepSeek chat completions over httpx. One request per call; no automatic retries.

Never log the API key, request messages (student work) or response content.
API reference: https://api-docs.deepseek.com/api/create-chat-completion
"""

import json
import os
import sys

import httpx

from ..types import ProviderRejected, ProviderTimeout, ProviderUnavailable, RawCompletion, Usage


def parse_usage(data):
    data = data or {}
    details = data.get('completion_tokens_details') or {}
    return Usage(
        cache_hit=int(data.get('prompt_cache_hit_tokens') or 0),
        cache_miss=int(data.get('prompt_cache_miss_tokens') or 0),
        completion=int(data.get('completion_tokens') or 0),
        reasoning=int(details.get('reasoning_tokens') or 0),
    )


class DeepSeekProvider:
    name = 'deepseek'

    def __init__(self, settings, transport=None):
        # Second guard from AGENTS.md: tests never reach a paid provider unless
        # a live test was explicitly opted into for an approved batch.
        if 'pytest' in sys.modules and os.getenv('MATH_MATE_LIVE_AI_TEST') != '1' and transport is None:
            raise ProviderRejected('Live AI requests are disabled during tests.')
        self.settings = settings
        self.model = settings.model
        self.transport = transport

    def payload(self, request, stream=False):
        body = {'model': self.model, 'messages': request.messages, 'max_tokens': request.max_tokens}
        if request.thinking:
            body['thinking'] = {'type': 'enabled'}
            if request.reasoning_effort:
                body['reasoning_effort'] = request.reasoning_effort
        else:
            body['thinking'] = {'type': 'disabled'}
        if request.json_output:
            body['response_format'] = {'type': 'json_object'}
        if stream:
            body['stream'] = True
            body['stream_options'] = {'include_usage': True}
        return body

    def client(self):
        return httpx.Client(timeout=httpx.Timeout(self.settings.timeout_seconds, connect=8),
                            transport=self.transport)

    def headers(self):
        return {'Authorization': f'Bearer {self.settings.api_key}', 'Content-Type': 'application/json'}

    @staticmethod
    def check(response):
        if response.status_code in (408, 429) or response.status_code >= 500:
            raise ProviderUnavailable(f'Provider returned HTTP {response.status_code}')
        if not response.is_success:
            raise ProviderRejected(f'Provider rejected the request with HTTP {response.status_code}')

    def complete(self, request):
        try:
            with self.client() as client:
                response = client.post(f'{self.settings.base_url}/chat/completions',
                                       headers=self.headers(), json=self.payload(request))
        except httpx.TimeoutException:
            raise ProviderTimeout() from None
        except httpx.HTTPError:
            raise ProviderUnavailable() from None
        self.check(response)
        try:
            data = response.json()
            choice = data['choices'][0]
            return RawCompletion(choice['message'].get('content') or '', choice.get('finish_reason') or '',
                                 parse_usage(data.get('usage')))
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderUnavailable('Provider returned an unexpected response shape') from None

    def stream(self, request):
        finish, usage = '', None
        try:
            with self.client() as client, client.stream(
                    'POST', f'{self.settings.base_url}/chat/completions',
                    headers=self.headers(), json=self.payload(request, stream=True)) as response:
                if not response.is_success:
                    response.read()
                    self.check(response)
                for line in response.iter_lines():
                    if not line.startswith('data:'):
                        continue
                    data = line[5:].strip()
                    if data == '[DONE]':
                        break
                    chunk = json.loads(data)
                    if chunk.get('usage'):
                        usage = parse_usage(chunk['usage'])
                    for choice in chunk.get('choices') or []:
                        text = (choice.get('delta') or {}).get('content')
                        if text:
                            yield 'delta', text, None
                        if choice.get('finish_reason'):
                            finish = choice['finish_reason']
        except httpx.TimeoutException:
            raise ProviderTimeout() from None
        except httpx.HTTPError:
            raise ProviderUnavailable() from None
        except ValueError:
            raise ProviderUnavailable('Provider returned an unexpected stream chunk') from None
        yield 'done', finish, usage
