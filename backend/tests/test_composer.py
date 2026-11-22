"""Least-privilege Composer context and leak-checked streaming."""

import json

import pytest

from backend.app.ai.providers import fake_provider
from backend.app.core.config import PROJECT_ROOT
from backend.app.tutoring import composer
from backend.app.tutoring.part_context import build_part_context
from backend.app.tutoring.policy import Decision

MISTAKE = {'student_step': '5p = 1510', 'description': 'Added 600 instead of subtracting.', 'type': 'calculation',
           'outcome_code': '2.5.2', 'misconception_id': None, 'points_lost': ['P3']}


@pytest.fixture
def context():
    question = json.loads((PROJECT_ROOT / 'data/topic-2-algebra-and-graphs/4024_s23_22_algebra_and_graphs.json').read_text(encoding='utf-8'))['questions'][0]
    return build_part_context(question, '4024-s23-22-q2-a')


def messages(context, move, level):
    return composer.build_messages(context, Decision(move, level, 'test'), MISTAKE, 'No history.', '5p = 1510', [], 'help')


def test_context_grows_only_with_the_assistance_level(context):
    hint = messages(context, 'small_hint', 2)[1]['content']
    assert 'marking_points' not in hint and 'p=62' not in hint.replace(' ', '')
    step = messages(context, 'worked_step', 4)[1]['content']
    assert '"P3"' in step and '"P0"' not in step
    solution = messages(context, 'full_solution', 5)[1]['content']
    assert '"P0"' in solution and 'p=62' in solution


def test_text_is_released_by_sentence_and_stopped_before_a_leak():
    tokens = ('p=62', '62')
    assert list(composer.safe_release(['Look at ', 'line 2. Then ', 'try again'], tokens, True)) == ['Look at line 2.', ' Then try again']
    released = []
    with pytest.raises(composer.AnswerLeak):
        for text in composer.safe_release(['Good. ', 'So p = ', '62. Done.'], tokens, True):
            released.append(text)
    assert released == ['Good.']
    assert list(composer.safe_release(['So p = 62.'], tokens, False)) == ['So p = 62.']


def test_a_leak_regenerates_once_then_uses_a_template(context, ledger):
    decision = Decision('small_hint', 2, 'test')
    fake_provider().queue('Nice start. The value is 62.', 'Check the sign when 600 moves across.')
    events = list(composer.stream_reply(context, decision, messages(context, 'small_hint', 2), ('62',)))
    assert events == [('delta', 'Nice start.'), ('reset', None), ('delta', 'Check the sign when 600 moves across.')]
    fake_provider().queue('It is 62.', 'Answer: 62.')
    assert list(composer.stream_reply(context, decision, messages(context, 'small_hint', 2), ('62',))) == [('fallback', None)]
    assert len(ledger.calls) == 4
    assert '5p = 1510' in composer.fallback_text(decision, context, MISTAKE)


def test_moves_without_teaching_content_need_no_model():
    assert not composer.needs_model('invite_resubmit') and not composer.needs_model('redirect')
    assert composer.template_text(Decision('invite_resubmit', 5, 'solution_shown_redo')).startswith('Now write')
