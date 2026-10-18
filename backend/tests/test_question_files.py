"""Acceptance gate for curated question files in data/*.json.

Every file produced by the extraction prompts must pass these checks before
import. They confirm the file fits this project (codes, skills, marks, IDs,
prompt blocks, response types); they cannot prove the transcription matches
the paper, which still needs a human review against the QP and MS.
"""

import json
import re

import pytest

from backend.app.core.config import PROJECT_ROOT
from backend.app.tutoring import catalogue
from backend.app.tutoring.part_context import build_part_context
from backend.scripts.import_questions import topic_code_for

FILE_NAME = re.compile(r'^4024_[sw]\d{2}_\d{2}_([a-z_]+)\.json$')
TOPIC_SLUGS = {
    '1': 'number', '2': 'algebra_and_graphs', '3': 'coordinate_geometry', '4': 'geometry', '5': 'mensuration',
    '6': 'trigonometry', '7': 'transformations_and_vectors', '8': 'probability', '9': 'statistics',
}
BLOCK_TYPES = {'paragraph', 'instruction', 'equation', 'formula', 'equation_system', 'table', 'sequence',
               'inequality_set', 'part_reference', 'shared_graph_reference', 'shared_content_reference',
               'graph', 'diagram', 'pattern_sequence'}
ELEMENT_TYPES = {'line', 'rect', 'polyline', 'curve', 'polygon', 'circle', 'point', 'label'}
RESPONSE_TYPES = {'working', 'short_answer', 'multiple_short_answers', 'short_text', 'coordinate_pair',
                  'table_completion', 'graph_plot', 'graph_sketch', 'graph_annotation', 'diagram_drawing',
                  # Older Topic 2 combinations, kept so existing files stay valid.
                  'graph_annotation_and_multiple_short_answers', 'graph_annotation_and_short_answer',
                  'graph_drawing', 'graphical_solution', 'graph_sketch_with_annotations'}
LEAF_ONLY = ('marks', 'response', 'mark_scheme', 'bank_alignment', 'source_alignment', 'skills')


def paper_files():
    return sorted((PROJECT_ROOT / 'data').glob('*.json'))


def leaves(node):
    children = node.get('parts') or []
    return [leaf for child in children for leaf in leaves(child)] if children else [node]


def nodes(node):
    yield node
    for child in node.get('parts') or []:
        yield from nodes(child)


def check_block(block, where):
    problems = []
    if block.get('type') not in BLOCK_TYPES:
        return [f'{where}: unsupported prompt block type {block.get("type")!r}']
    if block['type'] == 'graph':
        for axis in ('x_axis', 'y_axis'):
            span = (block.get(axis) or {}).get('range')
            if not (isinstance(span, list) and len(span) == 2 and all(isinstance(v, (int, float)) for v in span) and span[1] > span[0]):
                problems.append(f'{where}: graph {axis} needs an increasing numeric range')
    if block['type'] == 'diagram' and not (isinstance(block.get('view_box'), list) and len(block['view_box']) == 2):
        problems.append(f'{where}: diagram needs view_box [width, height]')
    panels = block.get('patterns') or [block]
    for panel in panels:
        for element in panel.get('elements') or []:
            allowed = ELEMENT_TYPES | ({'polynomial'} if block['type'] == 'graph' else set())
            if element.get('type') not in allowed:
                problems.append(f'{where}: unsupported drawing element {element.get("type")!r}')
    return problems


def file_problems(path):
    """Readable problems for one question file; an empty list means it fits the project."""
    paper = json.loads(path.read_text(encoding='utf-8'))
    collection, questions = paper.get('collection') or {}, paper.get('questions') or []
    problems = []
    match = FILE_NAME.match(path.name)
    if not match:
        return [f'{path.name}: name must be 4024_<sYY|wYY>_<component>_<topic_slug>.json']
    if paper.get('schema_version') != '1.1':
        problems.append('schema_version must be "1.1"')
    source = collection.get('source') or {}
    for field in ('year', 'session', 'component', 'calculator_allowed'):
        if field not in source:
            problems.append(f'collection.source.{field} is missing')
    known_outcomes, aliases = catalogue.outcomes(), catalogue.skill_outcomes()
    leaf_total = 0
    for question in questions:
        topic = topic_code_for(collection, question)
        strict = topic != '2'  # Older Topic 2 files predate answer_slots and strict containers.
        qid = question.get('id', '?')
        if TOPIC_SLUGS.get(topic) != match.group(1):
            problems.append(f'{qid}: topic {topic!r} does not match file slug {match.group(1)!r}')
        if strict and ((collection.get('syllabus') or {}).get('target_bank') or {}).get('topic_code') != topic:
            problems.append(f'{qid}: collection.syllabus.target_bank.topic_code must be set')
        ids = [node.get('id') for node in nodes(question)]
        if len(ids) != len(set(ids)) or not all(ids):
            problems.append(f'{qid}: every question and part needs a unique id')
        for node in nodes(question):
            for index, block in enumerate(node.get('prompt') or []):
                problems += check_block(block, f'{node.get("id")} prompt[{index}]')
            if strict and node is not question and node.get('parts') and any(key in node for key in LEAF_ONLY):
                problems.append(f'{node["id"]}: a container part must not have {", ".join(k for k in LEAF_ONLY if k in node)}')
        question_leaves = leaves(question)
        marks_sum = 0
        for leaf in question_leaves:
            lid = leaf.get('id') if question.get('parts') else f'{qid}-main'
            if question.get('parts') and not str(lid).startswith(f'{qid}-'):
                problems.append(f'{lid}: part id must start with {qid}-')
            marks = leaf.get('marks', question.get('total_marks')) if leaf is question else leaf.get('marks')
            scheme = leaf.get('mark_scheme') or {}
            if not isinstance(marks, int) or marks <= 0:
                problems.append(f'{lid}: marks must be a positive integer')
            elif scheme.get('marks') != marks:
                problems.append(f'{lid}: mark_scheme.marks {scheme.get("marks")} differs from marks {marks}')
            marks_sum += marks if isinstance(marks, int) else 0
            if not scheme.get('answer'):
                problems.append(f'{lid}: mark_scheme.answer is missing')
            for key in ('official_award_structure', 'official_partial_marks'):
                if any(not item.get('code') or not item.get('text') for item in scheme.get(key) or []):
                    problems.append(f'{lid}: every {key} entry needs code and text')
            response = leaf.get('response') or {}
            if response.get('type') not in RESPONSE_TYPES:
                problems.append(f'{lid}: unsupported response.type {response.get("type")!r}')
            if strict and response.get('type') == 'multiple_short_answers' and not response.get('answer_slots'):
                problems.append(f'{lid}: multiple_short_answers needs response.answer_slots')
            alignment = leaf.get('bank_alignment') or {}
            subtopic, codes = alignment.get('subtopic_code'), alignment.get('learning_outcome_codes') or []
            if catalogue.subtopic_of(codes[0] if codes else '') != subtopic or not codes:
                problems.append(f'{lid}: learning_outcome_codes must be non-empty and inside subtopic {subtopic!r}')
            for code in codes:
                if code not in known_outcomes or known_outcomes[code].subtopic != subtopic:
                    problems.append(f'{lid}: outcome {code!r} is unknown or outside subtopic {subtopic!r}')
            if subtopic and subtopic.split('.')[0] != topic:
                problems.append(f'{lid}: subtopic {subtopic!r} is not in topic {topic!r}')
            skills = leaf.get('skills') or {}
            for skill in [skills.get('primary'), *(skills.get('supporting') or [])]:
                if skill not in aliases:
                    problems.append(f'{lid}: skill {skill!r} is not in the controlled catalogue')
            try:
                build_part_context(question, lid)
            except (KeyError, TypeError, ValueError) as error:
                problems.append(f'{lid}: cannot build a marking context ({error!r})')
        if question.get('total_marks') != marks_sum:
            problems.append(f'{qid}: total_marks {question.get("total_marks")} differs from leaf sum {marks_sum}')
        leaf_total += len(question_leaves)
    counts = (collection.get('question_count'), collection.get('assessable_part_count'), collection.get('total_marks'))
    expected = (len(questions), leaf_total, sum(question.get('total_marks') or 0 for question in questions))
    if counts != expected:
        problems.append(f'collection counts {counts} should be {expected} (questions, leaf parts, marks)')
    return problems


@pytest.mark.parametrize('path', paper_files(), ids=lambda path: path.name)
def test_question_file_fits_the_project(path):
    problems = file_problems(path)
    assert not problems, f'{path.name}:\n  ' + '\n  '.join(problems)


def test_the_gate_reports_contract_breaks(tmp_path):
    leaf = {
        'id': '4024-s25-22-t4-q3-a', 'label': '(a)', 'marks': 2, 'prompt': [{'type': 'coordinate_grid'}],
        'response': {'type': 'multiple_short_answers'},
        'mark_scheme': {'answer': '$x=40$', 'marks': 3, 'official_award_structure': [{'code': 'M1'}]},
        'bank_alignment': {'subtopic_code': '4.6', 'learning_outcome_codes': ['4.7']},
        'skills': {'primary': 'invented_skill', 'supporting': []},
    }
    paper = {'schema_version': '1.1', 'collection': {
        'source': {'year': 2025, 'session': 'May/June', 'component': '22', 'calculator_allowed': True},
        'syllabus': {'target_bank': {'topic_code': '4'}}, 'question_count': 1, 'assessable_part_count': 1, 'total_marks': 2},
        'questions': [{'id': '4024-s25-22-t4-q3', 'number': 3, 'total_marks': 2, 'prompt': [], 'parts': [leaf]}]}
    path = tmp_path / '4024_s25_22_geometry.json'
    path.write_text(json.dumps(paper), encoding='utf-8')
    problems = '\n'.join(file_problems(path))
    for expected in ('unsupported prompt block type', 'mark_scheme.marks 3 differs', 'needs code and text',
                     'needs response.answer_slots', "outcome '4.7' is unknown or outside subtopic",
                     "skill 'invented_skill'"):
        assert expected in problems
    renamed = tmp_path / 'geometry_paper.json'
    path.rename(renamed)
    assert 'name must be' in file_problems(renamed)[0]


def test_question_ids_are_unique_across_files():
    seen = {}
    for path in paper_files():
        for question in json.loads(path.read_text(encoding='utf-8'))['questions']:
            assert question['id'] not in seen, f'{question["id"]} is in {seen.get(question["id"])} and {path.name}'
            seen[question['id']] = path.name
