"""Build the marking context for one question part from its curated JSON.

Marking points get synthetic ids because codes repeat within a part (B1, B1).
P0 is the full correct answer, worth all the marks; P1..Pn follow the official
award structure and then the official partial marks, in source order.
"""

import json
import re
from dataclasses import dataclass

from . import catalogue
from .leak_guard import answer_tokens

# Visual answers use the multimodal Marker and require a primary answer image.
GRAPH_RESPONSES = frozenset({
    'graph_plot', 'graph_sketch', 'graph_annotation', 'graph_annotation_and_short_answer',
    'graph_annotation_and_multiple_short_answers', 'graph_drawing', 'diagram_drawing',
    'graphical_solution', 'graph_sketch_with_annotations',
})
_CODE = re.compile(r'^(?P<kind>SC|M|A|B)?(?P<value>\d+)?(?P<ft>FT)?(?P<dep>DEP)?$')


@dataclass(frozen=True)
class MarkingPoint:
    id: str
    code: str
    text: str
    value: int
    kind: str
    follow_through: bool = False
    dependent: bool = False

    @property
    def special_case(self):
        return self.kind == 'SC'


@dataclass(frozen=True)
class PartContext:
    part_id: str
    question_id: str
    label: str
    marks: int
    prompt_text: str
    response_type: str
    answer_prefix: str
    final_answer: str
    final_answer_tokens: tuple
    marking_points: tuple
    primary_outcomes: tuple
    candidate_outcomes: tuple
    misconception_ids: tuple
    subtopic_code: str
    marking_notes: tuple = ()
    visual_blocks: tuple = ()

    @property
    def ai_markable(self):
        return self.marks > 0

    @property
    def visual_response(self):
        return self.response_type in GRAPH_RESPONSES

    def point(self, point_id):
        return next((point for point in self.marking_points if point.id == point_id), None)

    def model_view(self, include_scheme=True, point_ids=()):
        """JSON-ready context for prompts. Without the scheme, only named non-answer points are shown."""
        outcomes = catalogue.outcomes()
        misconceptions = catalogue.misconceptions()
        view = {
            'question_part': self.label,
            'marks': self.marks,
            'question': self.prompt_text,
            'answer_prefix': self.answer_prefix,
            'response_type': self.response_type,
            'candidate_outcomes': [{'code': code, 'text': outcomes[code].text} for code in self.candidate_outcomes],
            'misconceptions': [{'id': item, 'description': misconceptions[item].description} for item in self.misconception_ids],
        }
        shown = [point for point in self.marking_points
                 if point.id != 'P0' and (include_scheme or point.id in point_ids)]
        if include_scheme and not self.visual_response:
            shown.insert(0, self.marking_points[0])
        if shown:
            view['marking_points'] = [{'id': point.id, 'code': point.code, 'text': point.text} for point in shown]
        if include_scheme and self.marking_notes:
            view['marking_notes'] = list(self.marking_notes)
        if self.visual_response and self.visual_blocks:
            view['visual_specification'] = list(self.visual_blocks)
        return view

    def model_json(self, **options):
        return json.dumps(self.model_view(**options), ensure_ascii=False, separators=(',', ':'))


def ai_markable_response(response_type):
    # Kept as the public content capability helper. Visual types now use the
    # same Marker entry point with a mandatory primary image.
    return True


def parse_code(code):
    compact = re.sub(r'\s+', '', code or '').upper()
    match = _CODE.match(compact)
    if not match:
        return 'note', 0, False, False
    kind = match['kind'] or ('FT' if match['ft'] else 'note')
    return kind, int(match['value'] or 0), bool(match['ft']), bool(match['dep'])


def block_text(block):
    kind = block.get('type')
    if block.get('content'):
        return str(block['content'])
    if kind == 'equation_system':
        return '; '.join(block.get('equations') or [])
    if kind == 'inequality_set':
        return '; '.join(block.get('inequalities') or [])
    if kind == 'sequence':
        return ', '.join(str(value) for value in block.get('values') or [])
    if kind == 'table':
        return ' | '.join(', '.join('?' if cell is None else str(cell) for cell in row) for row in block.get('rows') or [])
    if block.get('alt'):
        return f"[{kind}: {block['alt']}]"
    if kind in ('graph', 'diagram'):
        return f'[{kind} printed with the question: {json.dumps(block, separators=(",", ":"))[:600]}]'
    return f'[{kind} printed with the question]'


def _find_leaf(node, part_id, prompts, labels):
    for part in node.get('parts') or []:
        path_prompts = [*prompts, *(part.get('prompt') or [])]
        path_labels = [*labels, *([part['label']] if part.get('label') else [])]
        if part.get('parts'):
            found = _find_leaf(part, part_id, path_prompts, path_labels)
            if found:
                return found
        elif part.get('id') == part_id:
            return part, path_prompts, path_labels
    return None


def build_part_context(question, part_id):
    """`question` is the stored question_data object. Raises KeyError for unknown parts."""
    if not question.get('parts') and part_id == f"{question['id']}-main":
        part, prompts, labels = question, list(question.get('prompt') or []), []
        question_prompts = []
    else:
        found = _find_leaf(question, part_id, [], [])
        if not found:
            raise KeyError(part_id)
        part, prompts, labels = found
        question_prompts = list(question.get('prompt') or [])
    scheme = part.get('mark_scheme') or {}
    response = part.get('response') or {}
    response_type = response.get('type') or 'working'
    marks = int(part.get('marks') or scheme.get('marks') or question.get('total_marks') or question.get('marks') or 0)
    prompt_text = '\n'.join(block_text(block) for block in [*question_prompts, *prompts])
    points = [MarkingPoint('P0', 'answer', scheme.get('answer') or '', marks, 'answer')]
    sources = [*(scheme.get('official_award_structure') or []), *(scheme.get('official_partial_marks') or [])]
    # Many visual schemes put the complete answer only in the answer column and
    # list merely a one-mark partial case below it. Completion is therefore an
    # explicit visual criterion, never the text-answer P0 shortcut. Validation
    # makes it mutually exclusive with the official partial criteria.
    if response_type in GRAPH_RESPONSES:
        points.append(MarkingPoint(
            'P1', f'B{marks}',
            f"Complete correct visual response: {scheme.get('answer') or 'as required by the question.'}",
            marks, 'visual_answer'))
    for index, item in enumerate(sources, len(points)):
        kind, value, follow_through, dependent = parse_code(item.get('code'))
        points.append(MarkingPoint(f'P{index}', (item.get('code') or '').strip(), item.get('text') or '',
                                   value, kind, follow_through, dependent or kind == 'A'))
    alignment = part.get('bank_alignment') or question.get('bank_alignment') or {}
    skills = part.get('skills') or {}
    aliases = catalogue.skill_outcomes()
    known = catalogue.outcomes()
    primary = [code for code in alignment.get('learning_outcome_codes') or [] if code in known]
    if not primary and aliases.get(skills.get('primary')):
        primary = [aliases[skills['primary']]]
    candidates = list(dict.fromkeys([*primary, *(aliases[skill] for skill in
                                     [skills.get('primary'), *(skills.get('supporting') or [])] if skill in aliases)]))
    misconception_ids = tuple(item.id for item in catalogue.misconceptions().values()
                              if set(item.outcomes) & set(candidates))
    visual_blocks = tuple(block for block in [*question_prompts, *prompts]
                          if block.get('type') in ('graph', 'diagram', 'pattern_sequence'))
    return PartContext(
        part_id=part_id,
        question_id=question['id'],
        label=''.join(labels) or 'Answer',
        marks=marks,
        prompt_text=prompt_text,
        response_type=response_type,
        answer_prefix=response.get('answer_prefix') or '',
        final_answer=scheme.get('answer') or '',
        final_answer_tokens=answer_tokens(scheme.get('answer') or '', prompt_text),
        marking_points=tuple(points),
        primary_outcomes=tuple(primary),
        candidate_outcomes=tuple(candidates),
        misconception_ids=misconception_ids,
        subtopic_code=alignment.get('subtopic_code') or (catalogue.subtopic_of(primary[0]) if primary else ''),
        marking_notes=tuple(scheme.get('marking_notes') or ()),
        visual_blocks=visual_blocks,
    )
