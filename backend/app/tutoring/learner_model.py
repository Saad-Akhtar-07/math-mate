"""Learner evidence and mastery, as pure functions over learning events.

Weights: independent work 1.0, assisted 0.5, after a full solution 0.25.
Blame: marks lost to a mistake on a supporting outcome do not count against the
part's main outcomes; that supporting outcome receives a failed observation.
Mastery: recency-weighted mean (30-day half-life) shrunk towards the subtopic
average, so thin evidence stays close to the prior and reports low confidence.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

FORMULA_VERSION = 'mastery-v1'
INDEPENDENT, ASSISTED, AFTER_SOLUTION = 1.0, 0.5, 0.25
HALF_LIFE_DAYS = 30
PRIOR_WEIGHT = 2.0
DEFAULT_PRIOR = 0.5


@dataclass(frozen=True)
class Evidence:
    outcome_code: str
    kind: str                      # attempt | misconception_observed | misconception_resolved
    score: float | None = None
    weight: float | None = None
    misconception_id: str | None = None


def evidence_weight(independent, solution_shown):
    if independent:
        return INDEPENDENT
    return AFTER_SOLUTION if solution_shown else ASSISTED


def assessment_evidence(context, mark_result, independent, solution_shown):
    if not mark_result.marked:
        return []
    output = mark_result.output
    weight = evidence_weight(independent, solution_shown)
    primary = context.primary_outcomes
    lost_elsewhere = sum(context.point(point_id).value
                         for mistake in output.mistakes if mistake.outcome_code not in primary
                         for point_id in set(mistake.points_lost) if point_id != 'P0' and context.point(point_id))
    maximum = mark_result.marks_maximum
    score = 1.0 if not maximum else min(1.0, (mark_result.marks_awarded + lost_elsewhere) / maximum)
    events = {(code, 'attempt', None): Evidence(code, 'attempt', round(score, 3), weight) for code in primary}
    for mistake in output.mistakes:
        if mistake.outcome_code not in primary:
            events.setdefault((mistake.outcome_code, 'attempt', None), Evidence(mistake.outcome_code, 'attempt', 0.0, weight))
        if mistake.misconception_id and mistake.misconception_id != 'other':
            key = (mistake.outcome_code, 'misconception_observed', mistake.misconception_id)
            events.setdefault(key, Evidence(*key[:2], misconception_id=key[2]))
    return list(events.values())


def resolution_evidence(observed):
    """`observed` holds (outcome_code, misconception_id) pairs addressed in a resolved session."""
    return [Evidence(code, 'misconception_resolved', misconception_id=item) for code, item in dict.fromkeys(observed)]


def mastery(attempts, prior=DEFAULT_PRIOR, now=None):
    """`attempts` holds (score, weight, created_at). Returns (mastery, confidence, evidence_weight)."""
    now = now or datetime.now(timezone.utc)
    weighted, total = 0.0, 0.0
    for score, weight, created_at in attempts:
        age_days = max(0.0, (now - created_at).total_seconds() / 86400)
        decayed = float(weight) * 0.5 ** (age_days / HALF_LIFE_DAYS)
        weighted += decayed * float(score)
        total += decayed
    value = (weighted + PRIOR_WEIGHT * prior) / (total + PRIOR_WEIGHT)
    return round(value, 3), round(total / (total + PRIOR_WEIGHT), 3), round(total, 3)
