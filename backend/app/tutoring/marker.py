"""Mark one submission, validated by the mark-scheme rules.

Text work gets at most one format-repair call. Visual work gets exactly one
model call so malformed output cannot spend a second image request. The
learner's history is never included: marks depend only on the submitted work.
"""

import base64
from dataclasses import replace

from pydantic import ValidationError

from ..ai import gateway
from ..ai.prompts import prompt
from ..ai.types import InvalidOutput, LLMRequest
from ..core.config import ai_settings
from .leak_guard import leaks, without_student_text
from .mark_rules import validate
from .schemas import MarkerOutput

UNREADABLE = 'I could not read your work clearly. Please retake the photo in good light, or type your working.'
OFF_TOPIC = 'This work does not seem to answer this question part. Check that you attached the right page.'
VISUAL_UNREADABLE = 'Retake the photo with the complete axes, scale, labels and drawing clearly visible.'
VISUAL_OFF_TOPIC = 'This image does not appear to show this question. Upload the correct complete graph or diagram.'
NEEDS_REVIEW = 'This visual answer could not be marked safely. Upload a clearer complete image.'
HIDDEN_STEP = 'A step in your working'


def build_messages(context, typed_work, images, visual_evidence=None):
    parts = [
        {'type': 'text', 'text': f'<part_context>\n{context.model_json()}\n</part_context>'},
        {'type': 'text', 'text': f'<student_work>\n{typed_work.strip() or "(no typed work)"}\n</student_work>'},
    ]
    if visual_evidence:
        import json
        parts.append({'type': 'text', 'text': '<visual_evidence>\n'
                      + json.dumps(visual_evidence, ensure_ascii=False, separators=(',', ':'))
                      + '\n</visual_evidence>'})
    for number, image_input in enumerate(images, 1):
        if isinstance(image_input, dict):
            image = image_input['data']
            label = image_input.get('label') or f'Photo page {number}'
        else:
            image, label = image_input, f'Photo page {number}'
        parts.append({'type': 'text', 'text': f'{label}:'})
        parts.append({'type': 'image_url', 'image_url': {
            'url': f'data:image/jpeg;base64,{base64.b64encode(image).decode()}', 'detail': 'auto'}})
    parts.append({'type': 'text', 'text': 'Mark this attempt and return the JSON object.'})
    content = parts if images else '\n\n'.join(part['text'] for part in parts)
    return [{'role': 'system', 'content': prompt('marker').text}, {'role': 'user', 'content': content}]


def parse(content):
    try:
        return MarkerOutput.model_validate_json(content)
    except ValidationError:
        raise InvalidOutput() from None


def _attempt(request, context):
    try:
        result = gateway.call(request)
    except InvalidOutput:
        return '', ['The response was not valid JSON.'], None
    try:
        output = parse(result.content)
    except InvalidOutput:
        return result.content, ['The response did not use the required JSON keys and value types.'], None
    mark_result, violations = validate(output, context)
    return result.content, violations, mark_result


def mark(context, typed_work, images=(), user_id=None, source_id=None, visual_evidence=None):
    settings = ai_settings()
    messages = build_messages(context, typed_work, list(images), visual_evidence)
    request = LLMRequest('marker', messages, settings.marker_max_tokens, prompt('marker').version,
                         thinking=True, reasoning_effort=settings.marker_reasoning_effort,
                         user_id=user_id, source_id=source_id)
    content, problems, mark_result = _attempt(request, context)
    if problems and not context.visual_response:
        repair = 'Your previous response broke these rules:\n- ' + '\n- '.join(problems) + '\nReturn the corrected JSON object only.'
        history = [{'role': 'assistant', 'content': content}] if content else []
        repaired = replace(request, messages=[*messages, *history, {'role': 'user', 'content': repair}])
        _, problems, mark_result = _attempt(repaired, context)
        if problems:
            raise InvalidOutput()
    if problems:
        raise InvalidOutput()
    return mark_result


def student_feedback(context, mark_result):
    """Feedback that is safe to show: never the final answer unless the student wrote it."""
    output = mark_result.output
    if output.status == 'unreadable':
        return VISUAL_UNREADABLE if context.visual_response else UNREADABLE
    if output.status == 'off_topic':
        return VISUAL_OFF_TOPIC if context.visual_response else OFF_TOPIC
    if output.status == 'needs_review':
        return NEEDS_REVIEW
    tokens = without_student_text(context.final_answer_tokens, output.what_i_read)
    feedback = output.feedback.strip()
    if feedback and not leaks(feedback, tokens):
        return feedback[:600]
    if mark_result.full_marks:
        return 'Well done: your working earns full marks.'
    step = output.mistakes[0].student_step if output.mistakes else 'your working'
    return f'You scored {mark_result.marks_awarded}/{mark_result.marks_maximum}. Look again at: {step}'[:600]


def student_review(context, mark_result):
    """Where marks were earned and lost, safe to show beside the working.

    Mark codes only, never the mark-scheme text. Mistakes keep the quoted step and
    its type but not the description, which may state the corrected step: the tutor
    gives that help one level at a time.
    """
    output = mark_result.output
    tokens = without_student_text(context.final_answer_tokens, output.what_i_read)
    awarded = set(mark_result.awarded_point_ids)
    lost = {point_id for mistake in output.mistakes for point_id in mistake.points_lost}
    # P0 is the whole answer; the marks total already reports it.
    scored = [point for point in context.marking_points[1:] if point.value]
    return {
        'points': [{'code': point.code, 'value': point.value, 'awarded': point.id in awarded}
                   for point in scored if point.id in awarded or point.id in lost],
        'mistakes': [{
            'step': HIDDEN_STEP if leaks(mistake.student_step, tokens) else mistake.student_step,
            'type': mistake.type,
            'marks_lost': [point.code for point in scored
                           if point.id in mistake.points_lost and point.id not in awarded],
        } for mistake in output.mistakes],
    }
