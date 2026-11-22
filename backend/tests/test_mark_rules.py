"""Deterministic mark-scheme rules: the model decides points, code adds them up."""

import pytest

from backend.app.tutoring.mark_rules import validate
from backend.app.tutoring.part_context import MarkingPoint, PartContext, parse_code
from backend.app.tutoring.schemas import MarkerOutput


def context(points, marks=3):
    marking = [MarkingPoint('P0', 'answer', 'x = 4', marks, 'answer')]
    for index, code in enumerate(points, 1):
        kind, value, follow_through, dependent = parse_code(code)
        marking.append(MarkingPoint(f'P{index}', code, f'point {index}', value, kind, follow_through, dependent or kind == 'A'))
    return PartContext('q-a', 'q', '(a)', marks, 'Solve 2x + 1 = 9.', 'working', '', 'x = 4', ('x=4',),
                       tuple(marking), ('2.5.2',), ('2.5.2', '2.2.2'), ('sign_error_moving_terms',), '2.5')


MISTAKE = {'student_step': '2x = 10', 'description': 'Sign error.', 'type': 'calculation',
           'outcome_code': '2.5.2', 'misconception_id': None, 'points_lost': ['P0']}


def output(awarded, mistakes=(MISTAKE,), status='marked', decided=None):
    decisions = [{'point_id': point, 'awarded': point in awarded, 'reason': ''} for point in (decided or awarded)]
    return MarkerOutput.model_validate({'status': status, 'what_i_read': '2x = 10', 'decisions': decisions,
                                        'mistakes': list(mistakes), 'feedback': 'Check line 1.'})


@pytest.mark.parametrize(('code', 'parsed'), [
    ('B1 FT', ('B', 1, True, False)), ('M1dep', ('M', 1, False, True)), ('FT', ('FT', 0, True, False)),
    ('SC1', ('SC', 1, False, False)), ('A1', ('A', 1, False, False)), ('B2', ('B', 2, False, False)),
    ('ISW', ('note', 0, False, False)),
])
def test_codes_are_parsed(code, parsed):
    assert parse_code(code) == parsed


def test_full_answer_point_is_full_marks_even_with_slips():
    result, violations = validate(output(['P0']), context(['M1', 'A1']))
    assert violations == [] and result.marks_awarded == 3 and result.full_marks


def test_partial_total_is_summed_and_capped():
    ctx = context(['B1', 'B2', 'M1'])
    assert validate(output(['P1']), ctx)[0].marks_awarded == 1
    assert validate(output(['P1', 'P2', 'P3']), ctx)[0].marks_awarded == 3


def test_duplicate_and_unknown_points_are_rejected():
    ctx = context(['B1', 'B1'])
    _, violations = validate(output(['P1'], decided=['P1', 'P1', 'P9']), ctx)
    assert any('more than once' in item for item in violations)
    assert any('P9 does not exist' in item for item in violations)


def test_accuracy_and_dependent_points_need_a_method_mark():
    ctx = context(['M1', 'A1', 'M1dep'])
    assert any('depends on a method mark' in item for item in validate(output(['P2']), ctx)[1])
    assert validate(output(['P1', 'P2']), ctx)[0].marks_awarded == 2


def test_special_case_only_when_nothing_else_scores():
    ctx = context(['B1', 'SC1'])
    assert any('special case' in item for item in validate(output(['P1', 'P2']), ctx)[1])
    assert validate(output(['P2']), ctx)[0].marks_awarded == 1


def test_lost_marks_need_a_mistake_and_closed_lists_are_enforced():
    ctx = context(['B1'])
    assert any('describe at least one mistake' in item for item in validate(output(['P1'], mistakes=()), ctx)[1])
    bad = {**MISTAKE, 'outcome_code': '2.9.1', 'misconception_id': 'invented', 'points_lost': ['P7']}
    _, violations = validate(output(['P1'], mistakes=(bad,)), ctx)
    assert len(violations) == 3
    other = {**MISTAKE, 'misconception_id': 'other'}
    assert validate(output(['P1'], mistakes=(other,)), ctx)[1] == []


@pytest.mark.parametrize('status', ['unreadable', 'off_topic', 'needs_review'])
def test_unmarked_work_awards_nothing(status):
    ctx = context(['B1'])
    result, violations = validate(output([], mistakes=(), status=status), ctx)
    assert violations == [] and result.marks_awarded is None and not result.marked
    assert validate(output(['P1'], mistakes=(), status=status), ctx)[1]
