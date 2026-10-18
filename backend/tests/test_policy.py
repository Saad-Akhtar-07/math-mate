"""Policy v1 rule table: one check per rule plus the escalation ladder."""

import pytest

from backend.app.tutoring.policy import TURN_CAP, TutorState, decide
from backend.app.tutoring.schemas import Observation


def seen(intent='attempt', result='incorrect', affect='neutral'):
    return Observation(intent=intent, attempt_result=result, affect=affect)


def state(**overrides):
    return TutorState(**{'intent': 'message', 'observation': seen(), 'mistake_type': 'method', **overrides})


@pytest.mark.parametrize(('overrides', 'move', 'level', 'reason'), [
    ({'turn_count': TURN_CAP}, 'full_solution', 5, 'turn_cap'),
    ({'level': 5}, 'invite_resubmit', 5, 'solution_shown_redo'),
    ({'observation': seen('off_topic', 'none'), 'level': 2}, 'redirect', 2, 'off_topic'),
    ({'observation': seen(result='correct'), 'level': 2, 'mistakes_remaining': 1}, 'ask_question', 1, 'step_fixed_next_mistake'),
    ({'observation': seen(result='correct'), 'level': 2}, 'invite_resubmit', 2, 'step_fixed'),
    ({'intent': 'show_step', 'observation': None}, 'worked_step', 4, 'requested_step'),
    ({'intent': 'explain', 'observation': None, 'level': 1}, 'explain_concept', 1, 'requested_explanation'),
    ({'observation': seen('asks_for_answer', 'none'), 'level': 4}, 'full_solution', 5, 'answer_requested_after_support'),
    ({'observation': seen('asks_for_answer', 'none'), 'level': 1, 'no_progress_streak': 2}, 'full_solution', 5, 'answer_requested_after_support'),
    ({'observation': seen('asks_for_answer', 'none'), 'level': 1}, 'formula_reminder', 2, 'answer_requested_escalate'),
    ({'observation': seen('question', 'none'), 'level': 2}, 'explain_concept', 2, 'student_question'),
    ({'observation': seen('affirmation', 'none'), 'level': 2}, 'encourage', 2, 'acknowledged'),
])
def test_rules_in_order(overrides, move, level, reason):
    decision = decide(state(**overrides))
    assert (decision.move, decision.level, decision.reason) == (move, level, reason)


@pytest.mark.parametrize(('overrides', 'level'), [
    ({}, 2),
    ({'mistake_type': 'calculation', 'mastery': 0.8, 'confidence': 0.6}, 1),
    ({'mistake_type': 'calculation', 'mastery': 0.8, 'confidence': 0.2}, 2),
    ({'misconception_seen': 2}, 3),
    ({'mistake_type': 'conceptual', 'mastery': 0.3}, 3),
    ({'observation': seen(affect='frustrated')}, 3),
])
def test_first_help_level_adapts_to_the_learner(overrides, level):
    decision = decide(state(**overrides))
    assert decision.level == level and decision.reason == 'first_help'


def test_repeated_failure_escalates_but_never_reveals_the_answer_by_hint():
    levels, current = [], 0
    for _ in range(5):
        decision = decide(state(level=current, intent='hint', observation=None))
        levels.append((decision.move, decision.level))
        current = decision.level
    assert levels == [('formula_reminder', 2), ('similar_example', 3), ('worked_step', 4),
                      ('worked_step', 4), ('worked_step', 4)]


def test_partial_progress_keeps_the_level_and_changes_the_move():
    decision = decide(state(level=2, observation=seen(result='partial'), last_move='formula_reminder'))
    assert (decision.move, decision.level, decision.streak) == ('small_hint', 2, 'reset')


def test_frustration_adds_warmth_and_one_level():
    decision = decide(state(level=1, observation=seen(affect='frustrated')))
    assert decision.level == 3 and decision.tone == 'warm'


def test_snapshot_is_json_ready():
    assert decide(state()).assistance == 2
    assert state().snapshot()['observation']['intent'] == 'attempt'
