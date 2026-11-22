"""Curriculum catalogues agree with each other and with every curated question part."""

import json

from backend.app.core.config import PROJECT_ROOT
from backend.app.tutoring import catalogue
from backend.scripts import sync_outcomes
from backend.app.tutoring.part_context import build_part_context


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
        assert len({point.id for point in context.marking_points}) == len(context.marking_points)
    # Grows as new topic files are added; Topic 2 alone has 396 leaf parts.
    assert count >= 396
