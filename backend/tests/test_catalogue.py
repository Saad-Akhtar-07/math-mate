"""Curriculum catalogues agree with each other and with every curated question part."""

import json

from backend.app.core.config import PROJECT_ROOT
from backend.app.tutoring import catalogue
from backend.scripts import sync_outcomes
from backend.app.tutoring.part_context import build_part_context

LEGACY_MISCONCEPTION_IDS = {
    'sign_error_moving_terms', 'wrong_inverse_operation', 'operation_on_one_side_only',
    'partial_bracket_expansion', 'negative_bracket_signs', 'missing_cross_terms',
    'combines_unlike_terms', 'incomplete_factorisation', 'factorisation_sign_error',
    'difference_of_squares_misused', 'cancels_terms_not_factors', 'fraction_addition_error',
    'numerator_not_fully_multiplied', 'index_laws_confused', 'negative_index_as_negative_value',
    'fractional_index_misread', 'index_not_applied_to_coefficient', 'quadratic_not_equal_to_zero',
    'quadratic_formula_substitution', 'root_sign_from_factor', 'elimination_sign_error',
    'incomplete_solution_set', 'inequality_not_reversed', 'inequality_boundary_convention',
    'wanted_region_shaded', 'nth_term_constant_error', 'term_position_confusion',
    'proportion_constant_missing', 'inverse_treated_as_direct', 'gradient_inverted',
    'graph_scale_misread', 'area_under_graph_error', 'substitution_order_error',
    'inverse_as_reciprocal', 'composite_order_reversed', 'inconsistent_units_in_equation',
    'relationship_reversed', 'subject_root_power_error',
}


def leaf_ids(question):
    def walk(node):
        for part in node.get('parts') or []:
            yield from walk(part) if part.get('parts') else [part]
    leaves = list(walk(question))
    return [(leaf['id'], leaf) for leaf in leaves] or [(f"{question['id']}-main", question)]


def source_parts():
    for path in sorted((PROJECT_ROOT / 'data').rglob('*.json')):
        for question in json.loads(path.read_text(encoding='utf-8'))['questions']:
            for part_id, part in leaf_ids(question):
                yield question, part_id, part


def test_catalogues_are_consistent():
    assert catalogue.catalogue_errors() == []
    assert len(catalogue.outcomes()) == 150


def test_every_outcome_has_direct_misconception_coverage_and_legacy_ids_remain_stable():
    items = catalogue.misconceptions()
    covered = {code for item in items.values() for code in item.outcomes}
    assert covered == set(catalogue.outcomes())
    assert LEGACY_MISCONCEPTION_IDS <= set(items)


def test_outcome_registry_matches_the_frontend_syllabus():
    # Regenerate with: python -m backend.scripts.sync_outcomes --apply
    current = json.loads(sync_outcomes.REGISTRY.read_text(encoding='utf-8'))
    assert sync_outcomes.generated(current) == current


def test_every_source_code_and_skill_resolves():
    outcomes, aliases = catalogue.outcomes(), catalogue.skill_outcomes()
    for question, part_id, part in source_parts():
        alignment = part.get('bank_alignment') or question.get('bank_alignment') or {}
        for code in alignment.get('learning_outcome_codes') or []:
            assert code in outcomes, f'{part_id}: {code}'
        skills = part.get('skills') or {}
        for skill in [skills.get('primary'), *(skills.get('supporting') or [])]:
            assert skill in aliases, f'{part_id}: skill {skill} has no outcome alias'


def test_every_part_builds_a_marking_context():
    count = 0
    for question, part_id, _part in source_parts():
        context = build_part_context(question, part_id)
        count += 1
        assert context.marks > 0 and context.final_answer, part_id
        assert context.marking_points[0].id == 'P0' and context.marking_points[0].value == context.marks
        assert context.primary_outcomes and set(context.primary_outcomes) <= set(context.candidate_outcomes), part_id
        assert context.misconception_ids, f'{part_id}: no misconceptions for {context.candidate_outcomes}'
        assert len({point.id for point in context.marking_points}) == len(context.marking_points)
    # Grows as new topic files are added; Topic 2 alone has 396 leaf parts.
    assert count >= 396
