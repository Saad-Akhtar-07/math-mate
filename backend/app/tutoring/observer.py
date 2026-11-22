"""Sense: classify the student's latest message. The Observer never writes to the student."""

from pydantic import ValidationError

from ..ai import gateway
from ..ai.prompts import prompt
from ..ai.types import InvalidOutput, LLMRequest
from ..core.config import ai_settings
from .schemas import Observation

# An unparseable classification should not end the lesson: treat it as no progress.
DEFAULT = Observation(intent='attempt', attempt_result='none', affect='neutral')


def conversation_text(turns):
    lines = []
    for turn in turns:
        lines.append(f'Student: {turn["learner_message"][:400]}')
        if turn.get('tutor_message'):
            lines.append(f'Tutor: {turn["tutor_message"][:400]}')
    return '\n'.join(lines) or '(none)'


def mistake_text(mistake):
    if not mistake:
        return 'none'
    return f'{mistake["student_step"]} | {mistake["description"]} | type: {mistake["type"]}'


def build_messages(context, mistake, recent_turns, message):
    user = '\n\n'.join([
        f'<part_context>\n{context.model_json()}\n</part_context>',
        f'<current_mistake>\n{mistake_text(mistake)}\n</current_mistake>',
        f'<recent_conversation>\n{conversation_text(recent_turns)}\n</recent_conversation>',
        f'<student_message>\n{message}\n</student_message>',
        'Classify the student message and return the JSON object.',
    ])
    return [{'role': 'system', 'content': prompt('observer').text}, {'role': 'user', 'content': user}]


def observe(context, mistake, recent_turns, message, user_id=None, source_id=None):
    request = LLMRequest('observer', build_messages(context, mistake, recent_turns, message),
                         ai_settings().observer_max_tokens, prompt('observer').version,
                         user_id=user_id, source_id=source_id)
    try:
        observation = Observation.model_validate_json(gateway.call(request).content)
    except (InvalidOutput, ValidationError):
        return DEFAULT
    if observation.misconception_id and observation.misconception_id not in context.misconception_ids:
        observation = observation.model_copy(update={'misconception_id': None})
    return observation
