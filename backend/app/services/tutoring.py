"""Tutor sessions and turns: Sense (Observer) -> Decide (policy) -> Act (Composer).

No database connection is held during a model call: the turn is committed as
`processing`, the models run, and the result is committed in a new transaction.
Streaming is only a view of the turn: a worker thread finishes and saves the
turn even if the browser disconnects, and polling then shows the saved reply.
"""

import json
import logging
import queue
import threading
from dataclasses import dataclass

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..ai.prompts import prompt
from ..ai.types import AIError, user_message
from ..core.config import ai_enabled
from ..db.connection import connect
from ..tutoring import composer, observer, policy
from ..tutoring.leak_guard import without_student_text
from ..tutoring.part_context import build_part_context
from . import learning

logger = logging.getLogger(__name__)
CARRIED_LEVEL_LIMIT = 3


@dataclass
class TurnPlan:
    owner: object
    part_id: str
    turn: dict
    session: dict
    context: object
    mistake: dict | None
    mistakes_remaining: int
    recent: list
    learner_card: str
    typed_work: str
    mastery: float | None
    confidence: float
    misconception_seen: int


def load_part_context(cursor, part_id):
    cursor.execute('''select q.question_data from math_mate.questions q
        join math_mate.question_parts p on p.question_id = q.id where p.id = %s and p.active''', (part_id,))
    row = cursor.fetchone()
    try:
        if row:
            return build_part_context(row['question_data'], part_id)
    except KeyError:
        pass
    raise HTTPException(404, 'Question part not found or retired')


def serialize_turn(row, part_id):
    failed = row['status'] == 'failed'
    return {
        'id': row['id'], 'client_message_id': row['client_message_id'], 'question_part_id': part_id,
        'intent': row['intent'], 'learner_message': row['learner_message'],
        'tutor_message': row.get('tutor_message'), 'teaching_move': row.get('teaching_move'),
        'status': row['status'], 'error_message': user_message(row['error_code']) if failed else None,
        'can_retry': failed and row['run_count'] < 2, 'created_at': row['created_at'],
    }


def sweep_stale_turns(cursor):
    cursor.execute('''update math_mate.tutor_turns set status = 'failed', error_code = 'interrupted', updated_at = now()
        where status = 'processing' and updated_at < now() - interval '2 minutes' ''')


def after_assessment(cursor, learner_id, part_id, assessment_id, session, mark_result):
    """Advance or resolve the tutoring loop once a submission has been marked."""
    if mark_result.full_marks:
        if session:
            cursor.execute('''update math_mate.tutor_sessions set state = %s, current_assessment_id = %s,
                ended_at = now(), updated_at = now() where id = %s''',
                ('resolved_with_solution' if session['solution_shown'] else 'resolved', assessment_id, session['id']))
            learning.record_resolution(cursor, learner_id, part_id, session['id'])
        return
    # New mistakes start a fresh ladder, but help already needed is carried over (capped below a worked step).
    cursor.execute('''insert into math_mate.tutor_sessions (learner_id, question_part_id, current_assessment_id, policy_version)
        values (%s, %s, %s, %s)
        on conflict (learner_id, question_part_id) where state = 'active' do update set
            current_assessment_id = excluded.current_assessment_id, mistake_index = 0,
            level = least(math_mate.tutor_sessions.level, %s), no_progress_streak = 0, updated_at = now()''',
        (learner_id, part_id, assessment_id, policy.POLICY_VERSION, CARRIED_LEVEL_LIMIT))


def _active_session(cursor, owner, part_id):
    cursor.execute('''select * from math_mate.tutor_sessions
        where learner_id = %s and question_part_id = %s and state = 'active' for update''', (owner, part_id))
    session = cursor.fetchone()
    if session:
        return session
    cursor.execute('''insert into math_mate.tutor_sessions (learner_id, question_part_id, policy_version)
        values (%s, %s, %s) on conflict (learner_id, question_part_id) where state = 'active' do nothing''',
        (owner, part_id, policy.POLICY_VERSION))
    cursor.execute('''select * from math_mate.tutor_sessions
        where learner_id = %s and question_part_id = %s and state = 'active' for update''', (owner, part_id))
    return cursor.fetchone()


def _ensure_idle(cursor, session_id, turn_id=None):
    cursor.execute('''select 1 from math_mate.tutor_turns where session_id = %s and status = 'processing'
        and id is distinct from %s''', (session_id, turn_id))
    if cursor.fetchone():
        raise HTTPException(409, 'The tutor is still answering your previous message.')


def start_turn(part_id, body, owner):
    """Commit the turn as processing and gather its context. Returns a TurnPlan, or a finished turn on retry."""
    if not ai_enabled():
        raise HTTPException(503, 'The AI tutor is not available yet. Your work is saved.')
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        context = load_part_context(cursor, part_id)
        sweep_stale_turns(cursor)
        cursor.execute('''select t.*, s.question_part_id from math_mate.tutor_turns t
            join math_mate.tutor_sessions s on s.id = t.session_id
            where t.learner_id = %s and t.client_message_id = %s for update of t''', (owner, body.client_message_id))
        turn = cursor.fetchone()
        if turn:
            if turn['question_part_id'] != part_id:
                raise HTTPException(409, 'This message belongs to another question.')
            if turn['status'] == 'completed' or (turn['status'] == 'failed' and turn['run_count'] >= 2):
                return serialize_turn(turn, part_id)
            if turn['status'] == 'processing':
                raise HTTPException(409, 'The tutor is still answering this message.')
            cursor.execute('select * from math_mate.tutor_sessions where id = %s for update', (turn['session_id'],))
            session = cursor.fetchone()
            _ensure_idle(cursor, session['id'], turn['id'])
            cursor.execute('''update math_mate.tutor_turns set status = 'processing', run_count = run_count + 1,
                error_code = null, updated_at = now() where id = %s returning *''', (turn['id'],))
            turn = cursor.fetchone()
        else:
            session = _active_session(cursor, owner, part_id)
            _ensure_idle(cursor, session['id'])
            cursor.execute('''insert into math_mate.tutor_turns (session_id, learner_id, client_message_id, intent, learner_message)
                values (%s, %s, %s, %s, %s) returning *''',
                (session['id'], owner, body.client_message_id, body.intent, body.message))
            turn = cursor.fetchone()

        mistakes = []
        if session['current_assessment_id']:
            cursor.execute('select result from math_mate.assessments where id = %s', (session['current_assessment_id'],))
            row = cursor.fetchone()
            mistakes = ((row or {}).get('result') or {}).get('mistakes') or []
        index = session['mistake_index']
        mistake = mistakes[index] if index < len(mistakes) else None
        cursor.execute('''select learner_message, tutor_message, teaching_move from math_mate.tutor_turns
            where session_id = %s and status = 'completed' order by created_at desc limit 6''', (session['id'],))
        recent = list(reversed(cursor.fetchall()))
        cursor.execute('''select typed_work from math_mate.student_responses
            where learner_id = %s and question_part_id = %s''', (owner, part_id))
        draft = cursor.fetchone()
        focus = mistake['outcome_code'] if mistake else (context.primary_outcomes[0] if context.primary_outcomes else None)
        mastery, confidence = learning.outcome_state(cursor, owner, focus) if focus else (None, 0.0)
        plan = TurnPlan(
            owner=owner, part_id=part_id, turn=turn, session=session, context=context, mistake=mistake,
            mistakes_remaining=max(0, len(mistakes) - index - 1), recent=recent,
            learner_card=learning.learner_card(cursor, owner, context),
            typed_work=draft['typed_work'] if draft else '', mastery=mastery, confidence=confidence,
            misconception_seen=learning.misconception_seen(cursor, owner, (mistake or {}).get('misconception_id')),
        )
    return plan


def produce(plan, emit):
    """Run Sense -> Decide -> Act for one turn, emitting (kind, data) events. Always ends with done or error."""
    turn, context, mistake = plan.turn, plan.context, plan.mistake
    try:
        observation = None
        if turn['intent'] == 'message':
            observation = observer.observe(context, mistake, plan.recent, turn['learner_message'], plan.owner, turn['id'])
        state = policy.TutorState(
            intent=turn['intent'], observation=observation,
            mistake_type=(mistake or {}).get('type'), misconception_seen=plan.misconception_seen,
            mastery=plan.mastery, confidence=plan.confidence, level=plan.session['level'],
            no_progress_streak=plan.session['no_progress_streak'], turn_count=plan.session['turn_count'],
            mistakes_remaining=plan.mistakes_remaining,
            last_move=plan.recent[-1]['teaching_move'] if plan.recent else None,
        )
        decision = policy.decide(state)
        emit('start', serialize_turn({**turn, 'teaching_move': decision.move}, plan.part_id))
        if composer.needs_model(decision.move):
            # Values the student has already written may be confirmed; anything else is protected.
            tokens = without_student_text(context.final_answer_tokens, plan.typed_work, turn['learner_message'],
                                          *(item['learner_message'] for item in plan.recent))
            messages = composer.build_messages(context, decision, mistake, plan.learner_card, plan.typed_work,
                                               plan.recent, turn['learner_message'])
            text = ''
            for kind, value in composer.stream_reply(context, decision, messages, tokens, plan.owner, turn['id']):
                if kind == 'delta':
                    text += value
                    emit('delta', {'text': value})
                elif kind == 'reset':
                    text = ''
                    emit('reset', {})
                else:
                    text = composer.fallback_text(decision, context, mistake)
                    emit('delta', {'text': text})
        else:
            text = composer.template_text(decision)
            emit('delta', {'text': text})
        emit('done', finish_turn(plan, state, decision, observation, text.strip()))
    except AIError as error:
        emit('error', fail_turn(plan, error.code))
    except Exception:
        logger.exception('Tutor turn failed')
        emit('error', fail_turn(plan, 'internal'))


def finish_turn(plan, state, decision, observation, text):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('select * from math_mate.tutor_sessions where id = %s for update', (plan.session['id'],))
        session = cursor.fetchone()
        streak = 0 if decision.streak == 'reset' else session['no_progress_streak'] + (decision.streak == 'increase')
        cursor.execute('''update math_mate.tutor_sessions set level = %s, max_assistance = greatest(max_assistance, %s),
            no_progress_streak = %s, turn_count = turn_count + 1, mistake_index = mistake_index + %s,
            solution_shown = solution_shown or %s, policy_version = %s, updated_at = now() where id = %s''',
            (decision.level, decision.assistance, streak, int(decision.next_mistake),
             decision.move == 'full_solution', policy.POLICY_VERSION, session['id']))
        cursor.execute('''update math_mate.tutor_turns set status = 'completed', observation = %s, decision_state = %s,
            teaching_move = %s, assistance = %s, reason = %s, tutor_message = %s, error_code = null,
            policy_version = %s, prompt_version = %s, completed_at = now(), updated_at = now()
            where id = %s returning *''',
            (Jsonb(observation.model_dump()) if observation else None, Jsonb(state.snapshot()), decision.move,
             decision.assistance, decision.reason, text[:2000] or composer.fallback_text(decision, plan.context, plan.mistake),
             policy.POLICY_VERSION, prompt('composer').version if composer.needs_model(decision.move) else None,
             plan.turn['id']))
        return serialize_turn(cursor.fetchone(), plan.part_id)


def fail_turn(plan, code):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''update math_mate.tutor_turns set status = 'failed', error_code = %s, tutor_message = null,
            teaching_move = null, updated_at = now() where id = %s returning *''', (code, plan.turn['id']))
        return serialize_turn(cursor.fetchone(), plan.part_id)


def sse(kind, data):
    return f'event: {kind}\ndata: {json.dumps(jsonable_encoder(data))}\n\n'


def stream_turn(plan):
    events = queue.Queue()
    threading.Thread(target=produce, args=(plan, lambda kind, data: events.put((kind, data))), daemon=True).start()
    while True:
        try:
            kind, data = events.get(timeout=150)
        except queue.Empty:
            yield sse('error', {'error_message': user_message('interrupted')})
            return
        yield sse(kind, data)
        if kind in ('done', 'error'):
            return


def complete_turn(plan):
    """Non-streaming path: run the turn and return the saved reply."""
    result = {}
    produce(plan, lambda kind, data: result.update({kind: data}))
    if 'error' in result:
        raise HTTPException(503, result['error']['error_message'])
    return result['done']


def list_turns(owner, topic_number):
    with connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        sweep_stale_turns(cursor)
        cursor.execute('''select t.*, s.question_part_id from math_mate.tutor_turns t
            join math_mate.tutor_sessions s on s.id = t.session_id
            join math_mate.question_parts p on p.id = s.question_part_id
            join math_mate.questions q on q.id = p.question_id
            where t.learner_id = %s and q.topic_code = %s order by t.created_at limit 1000''', (owner, topic_number))
        rows = cursor.fetchall()
    return {'turns': [serialize_turn(row, row['question_part_id']) for row in rows]}
