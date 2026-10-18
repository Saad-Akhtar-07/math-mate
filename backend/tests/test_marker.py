"""Marker messages, validation, single repair and safe feedback, using a real question part."""

import json

import pytest

from backend.app.ai.providers import fake_provider
from backend.app.ai.types import InvalidOutput, ProviderTimeout, RawCompletion, TruncatedOutput
from backend.app.core.config import PROJECT_ROOT
from backend.app.tutoring import marker
from backend.app.tutoring.part_context import build_part_context

WRONG = '5p + 8 x 75 = 910\n5p = 1510\np = 302'
RIGHT = '5p + 600 = 910\n5p = 310\np = 62'


@pytest.fixture
def context():
    question = json.loads((PROJECT_ROOT / 'data/4024_s23_22_algebra_and_graphs.json').read_text(encoding='utf-8'))['questions'][0]
    return build_part_context(question, '4024-s23-22-q2-a')


def valid(awarded=('P1',), feedback='Your equation is right. Check line 2.'):
    return {'status': 'marked', 'what_i_read': WRONG,
            'decisions': [{'point_id': point, 'awarded': True, 'reason': ''} for point in awarded],
            'mistakes': [{'student_step': '5p = 1510', 'description': 'Added 600 instead of subtracting.',
                          'type': 'calculation', 'outcome_code': '2.5.2', 'misconception_id': 'sign_error_moving_terms',
                          'points_lost': ['P2']}],
            'feedback': feedback, 'confidence': 'high'}


def test_messages_fence_student_work_and_attach_pages_as_data_urls(context):
    text_only = marker.build_messages(context, WRONG, [])
    assert text_only[0]['role'] == 'system' and 'Cambridge' in text_only[0]['content']
    assert '<student_work>\n' + WRONG in text_only[1]['content'] and '"P0"' in text_only[1]['content']
    with_page = marker.build_messages(context, '', [b'\xff\xd8jpeg'])
    parts = with_page[1]['content']
    assert '(no typed work)' in parts[1]['text']
    assert parts[3]['image_url']['url'].startswith('data:image/jpeg;base64,')


def test_deterministic_fake_marks_right_and_wrong_work(context, ledger):
    right = marker.mark(context, RIGHT)
    wrong = marker.mark(context, WRONG)
    assert right.full_marks and right.marks_awarded == 3
    assert wrong.marks_awarded == 0 and wrong.output.mistakes
    assert [call['purpose'] for call in ledger.calls] == ['marker', 'marker']


def test_one_repair_fixes_a_rule_violation(context, ledger):
    broken = {**valid(), 'decisions': [{'point_id': 'P9', 'awarded': True, 'reason': ''}]}
    fake_provider().queue(broken, valid())
    result = marker.mark(context, WRONG)
    assert result.marks_awarded == 1 and len(ledger.calls) == 2
    repair_messages = fake_provider().requests[1].messages
    assert repair_messages[-2]['role'] == 'assistant' and 'P9 does not exist' in repair_messages[-1]['content']


def test_non_json_then_valid_output_is_repaired(context, ledger):
    fake_provider().queue('not json', valid())
    assert marker.mark(context, WRONG).marks_awarded == 1


def test_second_failure_is_invalid_output(context, ledger):
    fake_provider().queue({'status': 'marked'}, {'status': 'nonsense'})
    with pytest.raises(InvalidOutput):
        marker.mark(context, WRONG)
    assert len(ledger.calls) == 2


def test_truncation_and_provider_errors_are_not_repaired(context, ledger):
    fake_provider().queue(RawCompletion('{"status":', 'length'))
    with pytest.raises(TruncatedOutput):
        marker.mark(context, WRONG)
    fake_provider().queue(ProviderTimeout())
    with pytest.raises(ProviderTimeout):
        marker.mark(context, WRONG)
    assert len(ledger.calls) == 2


def test_feedback_never_reveals_an_answer_the_student_has_not_written(context, ledger):
    fake_provider().queue(valid(feedback='Nearly: the answer is p = 62.'))
    result = marker.mark(context, WRONG)
    assert marker.student_feedback(context, result) == 'You scored 1/3. Look again at: 5p = 1510'
    fake_provider().queue({**valid(awarded=('P0',), feedback='Correct: p = 62.'), 'what_i_read': RIGHT, 'mistakes': []})
    result = marker.mark(context, RIGHT)
    assert marker.student_feedback(context, result) == 'Correct: p = 62.'


def test_unreadable_pages_get_a_retake_message(context, ledger):
    result = marker.mark(context, '', [b'jpeg'])
    assert not result.marked and marker.student_feedback(context, result) == marker.UNREADABLE
