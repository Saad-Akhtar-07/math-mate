"""Record learning evidence and maintain the mastery projection inside the caller's transaction.

Each statement is a network round trip, so evidence is written and read in
batches: one insert for all events, then a fixed number of statements however
many outcomes an assessment touches.
"""

from ..tutoring import catalogue
from ..tutoring.learner_model import FORMULA_VERSION, DEFAULT_PRIOR, assessment_evidence, mastery, resolution_evidence


def insert_events(cursor, learner_id, part_id, source_kind, source_id, events):
    if not events:
        return 0
    # The unique index makes recording the same source twice a no-op.
    cursor.execute('''insert into math_mate.learning_events
        (learner_id, question_part_id, outcome_code, kind, score, weight, misconception_id, source_kind, source_id)
        select %s, %s, e.outcome_code, e.kind, e.score, e.weight, e.misconception_id, %s, %s
        from unnest(%s::text[], %s::text[], %s::numeric[], %s::numeric[], %s::text[])
            as e(outcome_code, kind, score, weight, misconception_id)
        on conflict do nothing returning id''',
        (learner_id, part_id, source_kind, source_id,
         [event.outcome_code for event in events], [event.kind for event in events],
         [event.score for event in events], [event.weight for event in events],
         [event.misconception_id for event in events]))
    return len(cursor.fetchall())


def refresh_outcomes(cursor, learner_id, codes):
    known = catalogue.outcomes()
    codes = sorted(codes)
    siblings = {code: [item.code for item in known.values()
                       if item.subtopic == catalogue.subtopic_of(code) and item.code != code] for code in codes}
    cursor.execute('''select outcome_code, score, weight, created_at from math_mate.learning_events
        where learner_id = %s and outcome_code = any(%s) and kind = 'attempt' ''', (learner_id, codes))
    attempts = {}
    for row in cursor.fetchall():
        attempts.setdefault(row['outcome_code'], []).append((row['score'], row['weight'], row['created_at']))
    cursor.execute('''select outcome_code, mastery from math_mate.learner_outcome_state
        where learner_id = %s and outcome_code = any(%s)''',
        (learner_id, sorted({code for group in siblings.values() for code in group})))
    states = {row['outcome_code']: float(row['mastery']) for row in cursor.fetchall()}
    rows = []
    for code in codes:
        if code not in attempts:
            continue
        # The prior is the mean mastery of the other outcomes in this subtopic,
        # including any refreshed earlier in this loop.
        priors = [states[item] for item in siblings[code] if item in states]
        value, confidence, weight = mastery(attempts[code], sum(priors) / len(priors) if priors else DEFAULT_PRIOR)
        states[code] = value
        history = attempts[code]
        rows.append((code, value, confidence, weight, len(history),
                     sum(1 for score, w, _ in history if float(score) == 1 and float(w) == 1),
                     max(created for _, _, created in history)))
    if not rows:
        return
    columns = list(zip(*rows))
    cursor.execute('''insert into math_mate.learner_outcome_state
        (learner_id, outcome_code, mastery, confidence, evidence_weight, attempts, independent_full_marks,
         last_evidence_at, formula_version)
        select %s, r.*, %s from unnest(%s::text[], %s::numeric[], %s::numeric[], %s::numeric[], %s::int[], %s::int[],
            %s::timestamptz[]) as r
        on conflict (learner_id, outcome_code) do update set mastery = excluded.mastery,
            confidence = excluded.confidence, evidence_weight = excluded.evidence_weight,
            attempts = excluded.attempts, independent_full_marks = excluded.independent_full_marks,
            last_evidence_at = excluded.last_evidence_at, formula_version = excluded.formula_version,
            updated_at = now()''',
        (learner_id, FORMULA_VERSION, *[list(column) for column in columns]))


def record_assessment(cursor, learner_id, part_id, assessment_id, context, mark_result, independent, solution_shown):
    events = assessment_evidence(context, mark_result, independent, solution_shown)
    if insert_events(cursor, learner_id, part_id, 'assessment', assessment_id, events):
        refresh_outcomes(cursor, learner_id, {event.outcome_code for event in events if event.kind == 'attempt'})


def record_resolution(cursor, learner_id, part_id, session_id):
    # Misconceptions seen on this part since the session began are resolved by a full-mark resubmission.
    cursor.execute('''select distinct outcome_code, misconception_id from math_mate.learning_events
        where learner_id = %s and question_part_id = %s and kind = 'misconception_observed'
            and created_at >= (select created_at from math_mate.tutor_sessions where id = %s)''',
        (learner_id, part_id, session_id))
    observed = [(row['outcome_code'], row['misconception_id']) for row in cursor.fetchall()]
    insert_events(cursor, learner_id, part_id, 'tutor_session', session_id, resolution_evidence(observed))


def tutor_profile(cursor, learner_id, codes):
    """Everything the tutor needs about the learner, read in one round trip."""
    cursor.execute('''select
        (select coalesce(jsonb_object_agg(outcome_code, jsonb_build_object(
                'mastery', mastery, 'confidence', confidence, 'attempts', attempts)), '{}')
            from math_mate.learner_outcome_state
            where learner_id = %(learner)s and outcome_code = any(%(codes)s)) as states,
        (select coalesce(jsonb_object_agg(misconception_id, seen), '{}') from (
            select misconception_id, count(*) as seen from math_mate.learning_events
            where learner_id = %(learner)s and kind = 'misconception_observed'
            group by misconception_id) counts) as misconceptions_seen,
        (select coalesce(jsonb_agg(jsonb_build_object('id', misconception_id, 'seen', seen) order by seen desc), '[]') from (
            select misconception_id, count(*) filter (where kind = 'misconception_observed') as seen
            from math_mate.learning_events
            where learner_id = %(learner)s and misconception_id is not null and created_at > now() - interval '90 days'
            group by misconception_id
            having count(*) filter (where kind = 'misconception_observed') > count(*) filter (where kind = 'misconception_resolved')
            order by seen desc limit 2) recurring) as recurring,
        (select round(avg(max_assistance)) from (select max_assistance from math_mate.tutor_sessions
            where learner_id = %(learner)s and state <> 'active' order by updated_at desc limit 5) recent) as help_level''',
        {'learner': learner_id, 'codes': list(codes)})
    return cursor.fetchone()


def outcome_state(profile, code):
    state = profile['states'].get(code) if code else None
    return (float(state['mastery']), float(state['confidence'])) if state else (None, 0.0)


def misconception_seen(profile, misconception_id):
    if not misconception_id or misconception_id == 'other':
        return 0
    return profile['misconceptions_seen'].get(misconception_id, 0)


def learner_card(profile, context):
    """At most four short lines for the tutor. Never shown to the Marker."""
    known, items = catalogue.outcomes(), catalogue.misconceptions()
    parts = []
    for code in context.candidate_outcomes:
        state = profile['states'].get(code)
        if state and float(state['confidence']) >= 0.3:
            value = float(state['mastery'])
            label = 'strong' if value >= 0.75 else 'developing' if value >= 0.5 else 'weak'
            parts.append(f'{known[code].text}: {label} ({state["attempts"]} attempts)')
        else:
            parts.append(f'{known[code].text}: not enough practice yet')
    lines = ['; '.join(parts[:3])] if parts else []
    for item in profile['recurring']:
        if item['id'] in items:
            lines.append(f'Recurring difficulty: {items[item["id"]].description} (seen {item["seen"]} times).')
    if profile['help_level'] is not None:
        lines.append(f'On recent finished questions this student needed help up to level {int(profile["help_level"])} of 5.')
    return '\n'.join(lines[:4])
