"""Pedagogical policy v1: an ordered, explainable rule table in plain Python.

decide(state) -> Decision is the stable interface. Every decision is stored with
its inputs (TutorState.snapshot) so a future policy can be replayed against past
sessions before it replaces this one.
"""

from dataclasses import asdict, dataclass

from .schemas import Observation

POLICY_VERSION = 'policy-v1'
TURN_CAP = 15
MAX_HINT_LEVEL = 4   # level 5 (full solution) only via the turn cap or repeated answer requests
ASSISTANCE = {
    'check_understanding': 0, 'encourage': 0, 'redirect': 0, 'invite_resubmit': 0,
    'ask_question': 1, 'small_hint': 2, 'formula_reminder': 2,
    'explain_concept': 3, 'similar_example': 3, 'worked_step': 4, 'full_solution': 5,
}


@dataclass(frozen=True)
class TutorState:
    intent: str                          # message | hint | explain | show_step
    observation: Observation | None = None
    mistake_type: str | None = None
    misconception_seen: int = 0
    mastery: float | None = None
    confidence: float = 0.0
    level: int = 0                       # help level already reached on the current mistake
    no_progress_streak: int = 0
    turn_count: int = 0
    mistakes_remaining: int = 0          # mistakes after the current one
    last_move: str | None = None

    def snapshot(self):
        data = asdict(self)
        data['observation'] = self.observation.model_dump() if self.observation else None
        return data


@dataclass(frozen=True)
class Decision:
    move: str
    level: int
    reason: str
    tone: str = 'neutral'
    next_mistake: bool = False
    streak: str = 'keep'                 # keep | increase | reset

    @property
    def assistance(self):
        return ASSISTANCE[self.move]


def start_level(state):
    if state.misconception_seen >= 2 or (state.mistake_type == 'conceptual' and state.mastery is not None and state.mastery < 0.4):
        return 3
    if state.mistake_type == 'calculation' and state.mastery is not None and state.mastery >= 0.7 and state.confidence >= 0.5:
        return 1
    return 2


def move_for(level, mistake_type, last_move=None, alternate=False):
    if level >= 5:
        return 'full_solution'
    if level == 4:
        return 'worked_step'
    if level <= 1:
        return 'ask_question'
    options = (('formula_reminder', 'small_hint') if mistake_type in ('conceptual', 'method') else ('small_hint', 'formula_reminder')) \
        if level == 2 else (('explain_concept', 'similar_example') if mistake_type == 'conceptual' else ('similar_example', 'explain_concept'))
    return options[1] if alternate and last_move == options[0] else options[0]


def decide(state: TutorState) -> Decision:
    observation = state.observation
    if state.turn_count >= TURN_CAP:
        return Decision('full_solution', 5, 'turn_cap')
    if state.level >= 5:
        if observation and observation.intent == 'question':
            return Decision('explain_concept', 5, 'question_after_solution')
        return Decision('invite_resubmit', 5, 'solution_shown_redo')
    if observation and observation.intent == 'off_topic':
        return Decision('redirect', state.level, 'off_topic')
    if observation and observation.intent == 'attempt' and observation.attempt_result == 'correct':
        if state.mistakes_remaining > 0:
            return Decision('ask_question', 1, 'step_fixed_next_mistake', next_mistake=True, streak='reset')
        return Decision('invite_resubmit', state.level, 'step_fixed', streak='reset')
    if state.intent == 'show_step':
        return Decision('worked_step', MAX_HINT_LEVEL, 'requested_step')
    if state.intent == 'explain':
        return Decision('explain_concept', state.level, 'requested_explanation')
    if observation and observation.intent == 'asks_for_answer':
        if state.level >= MAX_HINT_LEVEL or state.no_progress_streak >= 2:
            return Decision('full_solution', 5, 'answer_requested_after_support')
        level = min(MAX_HINT_LEVEL, state.level + 1) if state.level else start_level(state)
        return Decision(move_for(level, state.mistake_type), level, 'answer_requested_escalate', streak='increase')
    if observation and observation.intent == 'question':
        return Decision('explain_concept', state.level, 'student_question')
    if observation and observation.intent == 'affirmation':
        return Decision('encourage', state.level, 'acknowledged')

    frustrated = bool(observation and observation.affect == 'frustrated')
    tone, bonus = ('warm', 1) if frustrated else ('neutral', 0)
    if state.level == 0:
        level = min(MAX_HINT_LEVEL, start_level(state) + bonus)
        streak = 'increase' if observation and observation.attempt_result in ('incorrect', 'none') else 'keep'
        return Decision(move_for(level, state.mistake_type), level, 'first_help', tone, streak=streak)
    if observation and observation.attempt_result == 'partial':
        level = min(MAX_HINT_LEVEL, state.level + bonus)
        return Decision(move_for(level, state.mistake_type, state.last_move, alternate=True), level,
                        'partial_progress', tone, streak='reset')
    level = min(MAX_HINT_LEVEL, state.level + 1 + bonus)
    reason = 'hint_requested' if state.intent == 'hint' else 'no_progress'
    return Decision(move_for(level, state.mistake_type), level, reason, tone, streak='increase')
