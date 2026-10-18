"""Act: write the chosen teaching move, streamed, with least-privilege context.

Below assistance level 4 the model never receives marking points or the final
answer, so it cannot reveal them. Streamed text is released a sentence at a
time and only after the accumulated reply passes the leak check.
"""

import re

from ..ai import gateway
from ..ai.prompts import prompt
from ..ai.types import LLMRequest
from ..core.config import ai_settings
from . import catalogue
from .leak_guard import leaks
from .observer import conversation_text, mistake_text

MOVE_INSTRUCTIONS = {
    'ask_question': 'Ask one guiding question that points the student at the step to check. Do not explain the fix.',
    'small_hint': 'Give one small hint about what to do differently in the step. Do not do the step.',
    'formula_reminder': 'Remind the student of the rule, formula or method needed for the step, without applying it to their numbers.',
    'explain_concept': 'Explain the underlying idea briefly in general terms, then ask the student to apply it to their step.',
    'similar_example': 'Show a short worked example with different numbers that uses the same method, then ask the student to apply it.',
    'worked_step': 'Show how to do only the next step correctly, briefly saying why, then ask the student to continue from there.',
    'full_solution': 'Give a clear, complete worked solution with the final answer. Then ask the student to rewrite the solution in their own working and check it again.',
    'check_understanding': 'Ask the student to explain in their own words why their corrected step works.',
}
TEMPLATES = {
    'invite_resubmit': 'That looks right. Update your working in the answer box, then press Check work to see your marks.',
    'redo_after_solution': 'Now write the full solution yourself in the answer box, then press Check work to see your marks.',
    'redirect': 'Let us stay with this question. Tell me which step you are working on, or press Hint if you are stuck.',
    'encourage': 'Great. Have a go at the next step and send me what you get.',
}
FALLBACKS = {
    'ask_question': 'Look carefully at this step: {step}. What is that line trying to do, and is each part of it correct?',
    'small_hint': 'Check this step again, one operation at a time: {step}. Which rule are you using there?',
    'formula_reminder': 'Check this step again, one operation at a time: {step}. Which rule are you using there?',
    'explain_concept': 'Think about the main idea for this part: {outcome}. How does it apply to your working?',
    'similar_example': 'Think about the main idea for this part: {outcome}. How does it apply to your working?',
    'worked_step': 'Focus only on this step: {step}. Do it carefully, then send me your result.',
    'full_solution': 'The answer from the mark scheme is {answer}. Compare it with your working, then rewrite the solution yourself.',
    'check_understanding': 'Can you explain in your own words why that step works?',
}
_SENTENCE_END = re.compile(r'[.!?](?=\s)|\n')


class AnswerLeak(Exception):
    pass


def needs_model(move):
    return move in MOVE_INSTRUCTIONS


def template_text(decision):
    if decision.move == 'invite_resubmit' and decision.reason == 'solution_shown_redo':
        return TEMPLATES['redo_after_solution']
    return TEMPLATES[decision.move]


def fallback_text(decision, context, mistake):
    outcomes = catalogue.outcomes()
    outcome = outcomes.get(mistake['outcome_code']).text if mistake and mistake.get('outcome_code') in outcomes else 'the method this question tests'
    step = mistake['student_step'] if mistake else 'your last step'
    return FALLBACKS[decision.move].format(step=step, outcome=outcome, answer=context.final_answer)


def build_messages(context, decision, mistake, learner_card, typed_work, recent_turns, message):
    if decision.assistance >= 5:
        part_json = context.model_json()
    elif decision.assistance == 4:
        lost = [point for point in (mistake or {}).get('points_lost', []) if point != 'P0']
        part_json = context.model_json(include_scheme=False,
                                       point_ids=lost or [point.id for point in context.marking_points])
    else:
        part_json = context.model_json(include_scheme=False)
    user = '\n\n'.join([
        f'<part_context>\n{part_json}\n</part_context>',
        f'<teaching_move>\n{decision.move}\n</teaching_move>',
        f'<move_instructions>\n{MOVE_INSTRUCTIONS[decision.move]} Tone: {decision.tone}.\n</move_instructions>',
        f'<current_mistake>\n{mistake_text(mistake)}\n</current_mistake>',
        f'<learner_profile>\n{learner_card or "No practice history yet."}\n</learner_profile>',
        f'<student_work>\n{(typed_work or "").strip()[:2000] or "(empty)"}\n</student_work>',
        f'<recent_conversation>\n{conversation_text(recent_turns)}\n</recent_conversation>',
        f'<student_message>\n{message}\n</student_message>',
    ])
    return [{'role': 'system', 'content': prompt('composer').text}, {'role': 'user', 'content': user}]


def safe_release(chunks, tokens, check):
    """Yield text a sentence at a time, raising AnswerLeak before any leaking text is released."""
    released, pending = '', ''
    for chunk in chunks:
        pending += chunk
        ends = list(_SENTENCE_END.finditer(pending))
        if not ends:
            continue
        cut = ends[-1].end()
        if check and leaks(released + pending[:cut], tokens):
            raise AnswerLeak()
        yield pending[:cut]
        released, pending = released + pending[:cut], pending[cut:]
    if check and leaks(released + pending, tokens):
        raise AnswerLeak()
    if pending:
        yield pending


def stream_reply(context, decision, messages, tokens, learner_id=None, source_id=None):
    """Yield ('delta', text) and ('reset', None) events. One regeneration on a leak, then a template."""
    request = LLMRequest('composer', messages, ai_settings().tutor_max_tokens, prompt('composer').version,
                         json_output=False, learner_id=learner_id, source_id=source_id)
    check = decision.assistance < 4
    emitted = False
    for _ in range(2):
        chunks = gateway.stream(request)
        try:
            for text in safe_release(chunks, tokens, check):
                emitted = True
                yield 'delta', text
            return
        except AnswerLeak:
            chunks.close()
            if emitted:
                yield 'reset', None
                emitted = False
    yield 'fallback', None
