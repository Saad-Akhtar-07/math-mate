"""Deterministic checks on Marker output. The model chooses points; code adds them up.

Rules: point ids must exist and appear once; outcomes and misconceptions must come
from the closed lists; P0 means full marks; otherwise the total is the sum of
awarded point values capped at the part's marks; an A or dep point needs an
awarded M point; SC applies only when nothing else scores; lost marks must be
explained by at least one mistake.
"""

from dataclasses import dataclass

from .schemas import MarkerOutput


@dataclass(frozen=True)
class MarkResult:
    output: MarkerOutput
    marks_awarded: int | None
    marks_maximum: int
    awarded_point_ids: tuple

    @property
    def marked(self):
        return self.output.status == 'marked'

    @property
    def full_marks(self):
        return self.marked and self.marks_awarded == self.marks_maximum


def validate(output: MarkerOutput, context):
    """Return (MarkResult, []) when valid, or (None, violations) as plain sentences."""
    violations = []
    ids = [decision.point_id for decision in output.decisions]
    violations += [f'Point {point_id} was decided more than once.' for point_id in sorted(set(ids)) if ids.count(point_id) > 1]
    violations += [f'Point {point_id} does not exist; use only the listed point ids.' for point_id in ids if not context.point(point_id)]
    awarded = tuple(decision.point_id for decision in output.decisions if decision.awarded and context.point(decision.point_id))
    if output.status != 'marked':
        if awarded:
            violations.append(f'Status {output.status} must not award any points.')
        return (None, violations) if violations else (MarkResult(output, None, context.marks, ()), [])

    if context.visual_response:
        expected = {point.id for point in context.marking_points if point.id != 'P0'}
        decided = set(ids)
        for point_id in sorted(expected - decided):
            violations.append(f'Visual point {point_id} needs exactly one decision.')
        if 'P0' in decided:
            violations.append('Visual responses must decide the listed criteria, not P0.')
        for decision in output.decisions:
            if decision.awarded and decision.point_id in expected and not decision.evidence_refs:
                violations.append(f'Visual point {decision.point_id} was awarded without evidence references.')

    for mistake in output.mistakes:
        if mistake.outcome_code not in context.candidate_outcomes:
            violations.append(f'Mistake outcome {mistake.outcome_code} is not one of the candidate outcomes.')
        if mistake.misconception_id not in (None, 'other') and mistake.misconception_id not in context.misconception_ids:
            violations.append(f'Misconception {mistake.misconception_id} is not listed; use a listed id, "other" or null.')
        violations += [f'Mistake refers to unknown point {point_id}.' for point_id in mistake.points_lost if not context.point(point_id)]

    visual_full = next((point for point in context.marking_points if point.kind == 'visual_answer'), None)
    if visual_full and visual_full.id in awarded and len(awarded) > 1:
        violations.append('The complete visual criterion cannot be awarded with partial visual criteria.')
    if 'P0' in awarded or (visual_full and visual_full.id in awarded):
        total = context.marks
    else:
        points = [context.point(point_id) for point_id in awarded]
        has_method_points = any(point.kind == 'M' for point in context.marking_points)
        method_awarded = any(point.kind == 'M' for point in points)
        for point in points:
            if point.dependent and has_method_points and not method_awarded:
                violations.append(f'{point.id} ({point.code}) depends on a method mark, but no M point was awarded.')
        if any(point.special_case for point in points) and any(not point.special_case for point in points):
            violations.append('A special case (SC) point can only be awarded when no other point scores.')
        total = min(context.marks, sum(point.value for point in points))
    if total < context.marks and not output.mistakes:
        violations.append('Marks were lost, so describe at least one mistake or missing step.')
    if violations:
        return None, violations
    return MarkResult(output, total, context.marks, awarded), []
