"""Evidence weights, blame assignment and the mastery formula."""

from datetime import datetime, timedelta, timezone

from backend.app.tutoring.learner_model import (AFTER_SOLUTION, ASSISTED, INDEPENDENT, assessment_evidence,
                                                evidence_weight, mastery)
from backend.app.tutoring.mark_rules import MarkResult
from backend.app.tutoring.part_context import MarkingPoint, PartContext
from backend.app.tutoring.schemas import MarkerOutput

NOW = datetime(2026, 10, 18, tzinfo=timezone.utc)
CONTEXT = PartContext('q-a', 'q', '(a)', 4, 'Solve x² + 2x - 8 = 0.', 'working', '', 'x = 2 or x = -4', ('x=2',),
                      (MarkingPoint('P0', 'answer', '', 4, 'answer'), MarkingPoint('P1', 'M1', 'expand', 1, 'M'),
                       MarkingPoint('P2', 'M1', 'factorise', 1, 'M'), MarkingPoint('P3', 'A2', 'roots', 2, 'A', dependent=True)),
                      ('2.5.5',), ('2.5.5', '2.2.2'), ('missing_cross_terms',), '2.5')


def result(awarded, mistakes):
    output = MarkerOutput.model_validate({'status': 'marked', 'decisions': [], 'mistakes': mistakes})
    return MarkResult(output, awarded, 4, ())


def test_weights_separate_independent_and_assisted_work():
    assert evidence_weight(True, False) == INDEPENDENT
    assert evidence_weight(False, False) == ASSISTED
    assert evidence_weight(False, True) == AFTER_SOLUTION


def test_marks_lost_to_a_supporting_skill_are_blamed_on_that_skill():
    slip = {'student_step': '(x+4)(x-2) = x² + 8', 'description': 'Missed the cross terms.', 'type': 'method',
            'outcome_code': '2.2.2', 'misconception_id': 'missing_cross_terms', 'points_lost': ['P1', 'P0']}
    events = assessment_evidence(CONTEXT, result(3, [slip]), independent=True, solution_shown=False)
    attempts = {event.outcome_code: event for event in events if event.kind == 'attempt'}
    assert attempts['2.5.5'].score == 1.0 and attempts['2.5.5'].weight == 1.0
    assert attempts['2.2.2'].score == 0.0
    assert [(e.outcome_code, e.misconception_id) for e in events if e.kind == 'misconception_observed'] == [('2.2.2', 'missing_cross_terms')]


def test_own_outcome_mistakes_lower_the_main_score():
    slip = {'student_step': 'x = -2', 'description': 'Sign of root.', 'type': 'calculation',
            'outcome_code': '2.5.5', 'misconception_id': None, 'points_lost': ['P3']}
    events = assessment_evidence(CONTEXT, result(2, [slip]), independent=False, solution_shown=False)
    assert [(e.outcome_code, e.score, e.weight) for e in events] == [('2.5.5', 0.5, 0.5)]


def test_unmarked_work_is_not_evidence():
    output = MarkerOutput.model_validate({'status': 'unreadable'})
    assert assessment_evidence(CONTEXT, MarkResult(output, None, 4, ()), True, False) == []


def test_mastery_shrinks_thin_evidence_towards_the_prior():
    assert mastery([], prior=0.5, now=NOW) == (0.5, 0.0, 0.0)
    one = mastery([(1, 1, NOW)], prior=0.5, now=NOW)
    many = mastery([(1, 1, NOW)] * 6, prior=0.5, now=NOW)
    assert one == (0.667, 0.333, 1.0)
    assert many[0] > one[0] and many[1] > one[1]


def test_old_and_assisted_evidence_counts_less():
    recent = mastery([(1, 1, NOW)], prior=0.0, now=NOW)
    old = mastery([(1, 1, NOW - timedelta(days=30))], prior=0.0, now=NOW)
    assisted = mastery([(1, 0.5, NOW)], prior=0.0, now=NOW)
    assert old[2] == 0.5 and assisted[2] == 0.5 and recent[0] > old[0]
