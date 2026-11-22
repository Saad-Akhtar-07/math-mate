"""Visual evidence stays advisory while deterministic rules guard model marks."""

import pytest

from backend.app.ai.providers import fake_provider
from backend.app.ai.types import InvalidOutput
from backend.app.tutoring import marker
from backend.app.tutoring.mark_rules import validate
from backend.app.tutoring.part_context import MarkingPoint, PartContext
from backend.app.tutoring.schemas import MarkerOutput
from backend.app.tutoring.visual_evidence import build


def visual_context():
    points = (
        MarkingPoint('P0', 'answer', 'Correct line', 2, 'answer'),
        MarkingPoint('P1', 'B2', 'Complete correct visual response: correct line.', 2, 'visual_answer'),
        MarkingPoint('P2', 'B1', 'A line with the correct gradient.', 1, 'B'),
    )
    return PartContext('q-a', 'q', '(a)', 2, 'Draw the line.', 'graph_plot', '', 'Correct line', (),
                       points, ('2.5.2',), ('2.5.2',), (), '2.5')


def output(awarded):
    return MarkerOutput.model_validate({
        'status': 'marked', 'what_i_read': 'A line is drawn.',
        'decisions': [
            {'point_id': point, 'awarded': point in awarded, 'reason': 'Visible line.',
             'evidence_refs': ['S1'], 'confidence': 'high'}
            for point in ('P1', 'P2')
        ],
        'mistakes': [] if 'P1' in awarded else [{
            'student_step': 'drawn line', 'description': 'The intercept is not correct.',
            'type': 'method', 'outcome_code': '2.5.2', 'points_lost': ['P1'],
        }],
        'feedback': 'Check the intercept.', 'confidence': 'high',
    })


def test_structured_line_measurements_are_compact_and_neutral():
    evidence = build({'version': 'visual-answer-v1', 'primary_source': 'canvas', 'objects': [
        {'id': 'student-line', 'type': 'line', 'from': [0, 1], 'to': [2, 5]},
        {'id': 'long-curve', 'type': 'curve', 'points': [[x, x * x] for x in range(100)]},
    ]})
    assert evidence['observations'] == [{
        'id': 'O1', 'type': 'line_equation', 'object_id': 'student-line',
        'gradient': 2.0, 'y_intercept': 1.0,
    }]
    assert evidence['objects'][1]['point_count'] == 100
    assert len(evidence['objects'][1]['points']) <= 25
    assert 'awarded' not in str(evidence)


def test_complete_visual_criterion_is_mutually_exclusive_with_partial_points():
    context = visual_context()
    result, problems = validate(output({'P1'}), context)
    assert problems == [] and result.marks_awarded == 2
    _, problems = validate(output({'P1', 'P2'}), context)
    assert any('cannot be awarded with partial' in problem for problem in problems)


def test_visual_marker_never_spends_a_repair_call(ledger):
    context = visual_context()
    broken = output({'P2'}).model_dump()
    broken['decisions'][0]['point_id'] = 'P0'
    fake_provider().queue(broken, output({'P2'}).model_dump())
    with pytest.raises(InvalidOutput):
        marker.mark(context, '', [b'jpeg'], visual_evidence={'objects': []})
    assert len(ledger.calls) == 1

