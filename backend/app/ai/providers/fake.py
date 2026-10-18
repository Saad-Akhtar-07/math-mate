"""Free deterministic provider for development and tests.

Deterministic mode imitates the real response formats well enough to exercise
every student flow. Scripted mode replays queued responses or errors so tests
can cover timeouts, malformed output, truncation and answer leaks.
"""

import json
import re
from collections import deque

from ..types import RawCompletion, Usage


def _tag(messages, name):
    text = '\n'.join(_texts(messages))
    match = re.search(rf'<{name}>\n?(.*?)\n?</{name}>', text, re.S)
    return match.group(1) if match else ''


def _texts(messages):
    # System prompts mention the tag names, so read only conversation content.
    for message in messages:
        if message['role'] == 'system':
            continue
        content = message['content']
        for part in content if isinstance(content, list) else [{'type': 'text', 'text': content}]:
            if part['type'] == 'text':
                yield part['text']


def _has_image(messages):
    return any(isinstance(m['content'], list) and any(p['type'] == 'image_url' for p in m['content']) for m in messages)


def _simple(text):
    return re.sub(r'[\s$\\{}]', '', text.lower()).rstrip('.')


def _answer_tokens(context):
    answer = next((p['text'] for p in context.get('marking_points', []) if p['id'] == 'P0'), '')
    tokens = []
    for piece in re.split(r'\s+or\s+|,|;', answer):
        piece = _simple(piece.replace('final answer', ''))
        if piece and re.search(r'\d', piece):
            tokens.append(piece.split('=')[-1])
    return tokens


class FakeProvider:
    name = 'fake'
    model = 'fake'

    def __init__(self):
        self.script = deque()
        self.requests = []

    def queue(self, *items):
        """Queue response content (str or dict) or an exception instance to raise."""
        self.script.extend(items)

    def _next(self, request):
        self.requests.append(request)
        if self.script:
            item = self.script.popleft()
            if isinstance(item, Exception):
                raise item
            if isinstance(item, RawCompletion):
                return item
            content = json.dumps(item) if isinstance(item, dict) else item
            return RawCompletion(content, 'stop', Usage(cache_miss=100, completion=50))
        return RawCompletion(getattr(self, f'_{request.purpose}')(request.messages), 'stop',
                             Usage(cache_miss=100, completion=50))

    def complete(self, request):
        return self._next(request)

    def stream(self, request):
        completion = self._next(request)
        for word in re.findall(r'\S+\s*', completion.content):
            yield 'delta', word, None
        yield 'done', completion.finish_reason, completion.usage

    def _marker(self, messages):
        context = json.loads(_tag(messages, 'part_context') or '{}')
        work = _tag(messages, 'student_work').strip()
        typed = '' if work == '(no typed work)' else work
        if not typed:
            status = 'unreadable' if _has_image(messages) else 'off_topic'
            return json.dumps({'status': status, 'what_i_read': '', 'decisions': [], 'mistakes': [],
                               'feedback': 'I could not mark this attempt.', 'confidence': 'low'})
        if any(token and token in _simple(typed) for token in _answer_tokens(context)):
            return json.dumps({'status': 'marked', 'what_i_read': typed,
                               'decisions': [{'point_id': 'P0', 'awarded': True, 'reason': 'Correct final answer.'}],
                               'mistakes': [], 'feedback': 'Well done: your working earns full marks.',
                               'confidence': 'high'})
        last_line = [line for line in typed.splitlines() if line.strip()][-1][:200]
        outcomes = [item['code'] for item in context.get('candidate_outcomes', [])] or ['2.1.2']
        return json.dumps({'status': 'marked', 'what_i_read': typed,
                           'decisions': [{'point_id': 'P0', 'awarded': False, 'reason': 'The answer is not correct.'}],
                           'mistakes': [{'student_step': last_line, 'description': 'This step does not lead to the required result.',
                                         'type': 'method', 'outcome_code': outcomes[0],
                                         'misconception_id': None, 'points_lost': ['P0']}],
                           'feedback': 'Good start. Look again at your last step.', 'confidence': 'medium'})

    def _observer(self, messages):
        context = json.loads(_tag(messages, 'part_context') or '{}')
        message = _tag(messages, 'student_message').strip()
        lower = message.lower()
        if any(token and token in _simple(message) for token in _answer_tokens(context)):
            intent, result = 'attempt', 'correct'
        elif 'answer' in lower or 'tell me' in lower:
            intent, result = 'asks_for_answer', 'none'
        elif lower.endswith('?'):
            intent, result = 'question', 'none'
        elif lower in ('ok', 'okay', 'thanks', 'thank you'):
            intent, result = 'affirmation', 'none'
        else:
            intent, result = 'attempt', 'incorrect'
        return json.dumps({'intent': intent, 'attempt_result': result, 'affect': 'neutral', 'misconception_id': None})

    def _composer(self, messages):
        move = _tag(messages, 'teaching_move').strip() or 'small_hint'
        return f'Let us take this one step at a time ({move.replace("_", " ")}). What could you try next for this step?'

    def _smoke(self, _messages):
        return json.dumps({'ok': True})
