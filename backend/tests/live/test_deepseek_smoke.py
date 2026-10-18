"""Opt-in live checks against DeepSeek. Never part of normal test runs.

Each test makes exactly ONE request, without retries or repairs, and prints only
safe usage metadata (no prompts, student work or model text). Run a gate only
after the project owner has approved that specific batch and its cost, e.g.:

    $env:MATH_MATE_LIVE_AI_TEST='1'; $env:MATH_MATE_AI_PROVIDER='deepseek'
    .\\.venv\\Scripts\\python.exe -m pytest backend/tests/live -s -k g1
"""

import io
import json
import os

import pytest

from backend.app.ai import gateway
from backend.app.ai.prompts import prompt
from backend.app.ai.types import LLMRequest
from backend.app.core.config import PROJECT_ROOT, ai_settings
from backend.app.tutoring import composer, marker, observer
from backend.app.tutoring.mark_rules import validate
from backend.app.tutoring.part_context import build_part_context
from backend.app.tutoring.policy import Decision

pytestmark = [pytest.mark.live, pytest.mark.skipif(
    os.getenv('MATH_MATE_LIVE_AI_TEST') != '1' or os.getenv('MATH_MATE_AI_PROVIDER') != 'deepseek',
    reason='Live AI gates need MATH_MATE_LIVE_AI_TEST=1, MATH_MATE_AI_PROVIDER=deepseek and owner approval')]

WRONG = '5p + 8 x 75 = 910\n5p = 1510\np = 302'


@pytest.fixture
def context():
    question = json.loads((PROJECT_ROOT / 'data/4024_s23_22_algebra_and_graphs.json').read_text(encoding='utf-8'))['questions'][0]
    return build_part_context(question, '4024-s23-22-q2-a')


def report(label, result):
    usage = result.usage
    print(f'\n[{label}] model={result.model} finish={result.finish_reason} cache_hit={usage.cache_hit} '
          f'cache_miss={usage.cache_miss} completion={usage.completion} reasoning={usage.reasoning} '
          f'cost_usd={result.cost_usd} latency_ms={result.latency_ms}')


def test_g1_marker_text_only(context, ledger):
    """Gate G1: one Marker request on typed work, thinking on (low effort), max_tokens 1024."""
    request = LLMRequest('marker', marker.build_messages(context, WRONG, []), 1024, prompt('marker').version,
                         thinking=True, reasoning_effort='low')
    result = gateway.call(request)
    report('G1 marker', result)
    mark_result, violations = validate(marker.parse(result.content), context)
    print(f'[G1 marker] rule_violations={len(violations)} marks={mark_result.marks_awarded if mark_result else None}/3')
    assert len(ledger.calls) == 1


def test_g2_marker_one_photo(context, ledger):
    """Gate G2: one Marker request with one synthetic printed page and no typed work."""
    from PIL import Image, ImageDraw, ImageFont
    page = Image.new('RGB', (1000, 500), 'white')
    draw = ImageDraw.Draw(page)
    font = ImageFont.load_default(size=48)
    for line_number, line in enumerate(WRONG.splitlines()):
        draw.text((60, 60 + line_number * 110), line, fill='black', font=font)
    buffer = io.BytesIO()
    page.save(buffer, 'JPEG', quality=85)
    request = LLMRequest('marker', marker.build_messages(context, '', [buffer.getvalue()]), 1024,
                         prompt('marker').version, thinking=True, reasoning_effort='low')
    result = gateway.call(request)
    report('G2 marker+photo', result)
    output = marker.parse(result.content)
    print(f'[G2 marker+photo] status={output.status} read_lines={len(output.what_i_read.splitlines())}')
    assert len(ledger.calls) == 1


def test_g3_observer_and_composer(context, ledger):
    """Gate G3: one Observer request and one streamed Composer request, thinking off."""
    mistake = {'student_step': '5p = 1510', 'description': 'Added 600 instead of subtracting it.', 'type': 'calculation',
               'outcome_code': '2.5.2', 'misconception_id': 'sign_error_moving_terms', 'points_lost': ['P3']}
    observation = observer.observe(context, mistake, [], 'so 5p = 910 - 600?')
    print(f'\n[G3 observer] intent={observation.intent} attempt_result={observation.attempt_result}')
    decision = Decision('small_hint', 2, 'live_check')
    messages = composer.build_messages(context, decision, mistake, '', WRONG, [], 'help')
    events = list(composer.stream_reply(context, decision, messages, context.final_answer_tokens))
    print(f'[G3 composer] events={[kind for kind, _ in events][:3]} chars={sum(len(text or "") for _, text in events)}')
    assert [call['purpose'] for call in ledger.calls] == ['observer', 'composer']
    print(f'[G3] ledger={[(call["status"], str(call["cost"])) for call in ledger.calls]} model={ai_settings().model}')
