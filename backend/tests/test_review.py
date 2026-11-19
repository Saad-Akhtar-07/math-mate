"""The student-safe review shown beside the working: mark codes, quoted steps and mistake types only."""

import json
from datetime import datetime, timezone

import pytest

from backend.app.ai.providers import fake_provider
from backend.app.core.config import PROJECT_ROOT
from backend.app.services.assessments import serialize
from backend.app.tutoring import marker
from backend.app.tutoring.part_context import build_part_context

WRONG = '5p + 8 x 75 = 910\n5p = 1510\np = 302'


@pytest.fixture
def context():
    question = json.loads((PROJECT_ROOT / 'data/topic-2-algebra-and-graphs/4024_s23_22_algebra_and_graphs.json').read_text(encoding='utf-8'))['questions'][0]
    return build_part_context(question, '4024-s23-22-q2-a')


def output(mistakes, awarded=('P1',)):
    return {'status': 'marked', 'what_i_read': WRONG,
            'decisions': [{'point_id': point, 'awarded': True, 'reason': ''} for point in awarded],
            'mistakes': mistakes, 'feedback': 'Check line 2.', 'confidence': 'high'}


def mistake(step, points_lost=('P2',), kind='calculation'):
    return {'student_step': step, 'description': 'Added 600 instead of subtracting, so 5p = 310.', 'type': kind,
            'outcome_code': '2.5.2', 'misconception_id': None, 'points_lost': list(points_lost)}


def test_review_lists_earned_and_lost_codes_without_scheme_text_or_the_fix(context, ledger):
    fake_provider().queue(output([mistake('5p = 1510')]))
    review = marker.student_review(context, marker.mark(context, WRONG))
    assert review == {
        'points': [{'code': 'B1', 'value': 1, 'awarded': True}, {'code': 'B2', 'value': 2, 'awarded': False}],
        'mistakes': [{'step': '5p = 1510', 'type': 'calculation', 'marks_lost': ['B2']}],
    }
    text = json.dumps(review)
    assert 'subtracting' not in text and 'correct equation' not in text.lower()


def test_points_never_decided_and_the_whole_answer_point_are_left_out(context, ledger):
    fake_provider().queue(output([mistake('p = 302', points_lost=('P0', 'P3'), kind='method')], awarded=()))
    review = marker.student_review(context, marker.mark(context, WRONG))
    assert review['points'] == [{'code': 'M1', 'value': 1, 'awarded': False}]
    assert review['mistakes'][0]['marks_lost'] == ['M1']


def test_a_step_that_states_an_unwritten_answer_is_replaced(context, ledger):
    fake_provider().queue(output([mistake('Missing step: p = 62')]))
    review = marker.student_review(context, marker.mark(context, WRONG))
    assert review['mistakes'][0]['step'] == marker.HIDDEN_STEP


def row(result):
    return {'id': 1, 'status': 'completed', 'result': result, 'marks_awarded': 1, 'marks_maximum': 3,
            'feedback': 'Check line 2.', 'error_code': None, 'run_count': 1,
            'created_at': datetime(2026, 10, 20, tzinfo=timezone.utc)}


def test_serialize_sends_the_review_and_older_attempts_have_none():
    review = {'points': [], 'mistakes': []}
    assert serialize(row({'status': 'marked', 'what_i_read': WRONG, 'review': review}), 'p', 1)['review'] == review
    assert serialize(row({'status': 'marked', 'what_i_read': WRONG}), 'p', 1)['review'] is None
    assert serialize({**row({'status': 'unreadable', 'review': review}), 'status': 'unreadable'}, 'p', 1)['review'] is None
