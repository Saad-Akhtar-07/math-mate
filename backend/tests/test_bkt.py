"""Pure shadow-BKT calculations; no model provider or database is used."""

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.services.learning import context_from_weight, replay_context_history
from backend.app.tutoring.bkt import (
    AFTER_SOLUTION,
    ASSISTED,
    CONTEXT_BASELINE,
    INDEPENDENT,
    BASELINE,
    ContextParameters,
    Parameters,
    apply_forgetting,
    context_probability_correct,
    contextual_update,
    evidence_confidence,
    forgetting,
    probability_correct,
    update,
)


def test_correct_evidence_increases_and_wrong_evidence_decreases_mastery():
    prior = BASELINE.initial_mastery
    assert update(prior, True) > prior
    assert update(prior, False) < prior


def test_guess_and_slip_keep_one_observation_from_proving_certainty():
    assert 0.0 < update(0.5, False) < 1.0
    assert 0.0 < update(0.5, True) < 1.0


def test_prediction_and_updates_stay_in_probability_range():
    mastery = BASELINE.initial_mastery
    for correct in (True, True, False, True, False):
        prediction = probability_correct(mastery)
        assert 0.0 <= prediction <= 1.0
        mastery = update(mastery, correct)
        assert 0.0 <= mastery <= 1.0


def test_parameters_reject_invalid_probabilities():
    with pytest.raises(ValueError):
        Parameters(guess=1.1)


def test_assisted_correctness_is_weaker_mastery_evidence_than_independent_correctness():
    independent = contextual_update(0.5, True, INDEPENDENT)
    assisted = contextual_update(0.5, True, ASSISTED)
    assert independent.mastery_after_observation > assisted.mastery_after_observation
    assert context_probability_correct(0.5, ASSISTED) > context_probability_correct(0.5, INDEPENDENT)


def test_after_solution_ignores_correctness_but_applies_learning_transition():
    correct = contextual_update(0.5, True, AFTER_SOLUTION)
    incorrect = contextual_update(0.5, False, AFTER_SOLUTION)
    assert correct == incorrect
    assert not correct.observation_used
    assert correct.mastery_after_observation == 0.5
    assert correct.mastery_after > correct.mastery_after_observation


@pytest.mark.parametrize(('days', 'bucket', 'probability'), [
    (15, '0_15_days', 0.0),
    (16, '16_30_days', CONTEXT_BASELINE.forget_16_30_days),
    (31, '31_60_days', CONTEXT_BASELINE.forget_31_60_days),
    (61, 'over_60_days', CONTEXT_BASELINE.forget_over_60_days),
])
def test_forgetting_uses_documented_time_buckets(days, bucket, probability):
    assert forgetting(days) == (bucket, probability)


def test_forgetting_is_applied_before_observation_and_keeps_probabilities_valid():
    result = contextual_update(0.8, True, INDEPENDENT, elapsed_days=61)
    assert result.mastery_after_forgetting == pytest.approx(0.8 * 0.9)
    assert 0.0 <= result.mastery_after <= 1.0
    projected, bucket, probability = apply_forgetting(0.8, 61)
    assert projected == pytest.approx(0.72)
    assert bucket == 'over_60_days'
    assert probability == pytest.approx(0.1)


def test_context_parameters_reject_assistance_that_reduces_guess_probability():
    with pytest.raises(ValueError):
        ContextParameters(independent_guess=0.3, assisted_guess=0.2)


def test_historical_weights_recover_the_three_contexts():
    assert context_from_weight(1) == INDEPENDENT
    assert context_from_weight(0.5) == ASSISTED
    assert context_from_weight(0.25) == AFTER_SOLUTION


def test_historical_replay_preserves_order_context_and_elapsed_time():
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = [
        {'score': 0, 'weight': 1, 'created_at': started},
        {'score': 1, 'weight': 0.5, 'created_at': started + timedelta(days=20)},
        {'score': 1, 'weight': 0.25, 'created_at': started + timedelta(days=70)},
    ]
    first = contextual_update(CONTEXT_BASELINE.initial_mastery, False, INDEPENDENT)
    second = contextual_update(first.mastery_after, True, ASSISTED, 20)
    third = contextual_update(second.mastery_after, True, AFTER_SOLUTION, 50)
    mastery, count, last_evidence_at = replay_context_history(rows)
    assert mastery == pytest.approx(third.mastery_after)
    assert count == 3
    assert last_evidence_at == rows[-1]['created_at']


def test_runtime_confidence_requires_repeated_diagnostic_observations():
    assert evidence_confidence(0) == 0.0
    assert evidence_confidence(1) == 0.333
    assert evidence_confidence(2) == 0.5
    assert evidence_confidence(6) == 0.75
