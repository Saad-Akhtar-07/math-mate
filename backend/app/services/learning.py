"""Record learning evidence and maintain the mastery projection inside the caller's transaction."""

from ..tutoring import catalogue
from ..tutoring.learner_model import FORMULA_VERSION, DEFAULT_PRIOR, assessment_evidence, mastery, resolution_evidence


def insert_events(cursor, learner_id, part_id, source_kind, source_id, events):
    inserted = 0
    for event in events:
        # The unique index makes recording the same source twice a no-op.
        cursor.execute('''insert into math_mate.learning_events
            (learner_id, question_part_id, outcome_code, kind, score, weight, misconception_id, source_kind, source_id)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing''',
            (learner_id, part_id, event.outcome_code, event.kind, event.score, event.weight,
             event.misconception_id, source_kind, source_id))
        inserted += cursor.rowcount
    return inserted


def refresh_outcomes(cursor, learner_id, codes):
    known = catalogue.outcomes()
    for code in sorted(codes):
        cursor.execute('''select score, weight, created_at from math_mate.learning_events
            where learner_id = %s and outcome_code = %s and kind = 'attempt' ''', (learner_id, code))
        attempts = [(row['score'], row['weight'], row['created_at']) for row in cursor.fetchall()]
        if not attempts:
            continue
        siblings = [item.code for item in known.values() if item.subtopic == catalogue.subtopic_of(code) and item.code != code]
        cursor.execute('''select avg(mastery) as prior from math_mate.learner_outcome_state
            where learner_id = %s and outcome_code = any(%s)''', (learner_id, siblings))
        prior = cursor.fetchone()['prior']
        value, confidence, weight = mastery(attempts, float(prior) if prior is not None else DEFAULT_PRIOR)
        cursor.execute('''insert into math_mate.learner_outcome_state
            (learner_id, outcome_code, mastery, confidence, evidence_weight, attempts, independent_full_marks,
             last_evidence_at, formula_version)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (learner_id, outcome_code) do update set mastery = excluded.mastery,
                confidence = excluded.confidence, evidence_weight = excluded.evidence_weight,
                attempts = excluded.attempts, independent_full_marks = excluded.independent_full_marks,
                last_evidence_at = excluded.last_evidence_at, formula_version = excluded.formula_version,
                updated_at = now()''',
            (learner_id, code, value, confidence, weight, len(attempts),
             sum(1 for score, w, _ in attempts if float(score) == 1 and float(w) == 1),
             max(created for _, _, created in attempts), FORMULA_VERSION))


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


def outcome_state(cursor, learner_id, code):
    cursor.execute('''select mastery, confidence from math_mate.learner_outcome_state
        where learner_id = %s and outcome_code = %s''', (learner_id, code))
    row = cursor.fetchone()
    return (float(row['mastery']), float(row['confidence'])) if row else (None, 0.0)


def misconception_seen(cursor, learner_id, misconception_id):
    if not misconception_id or misconception_id == 'other':
        return 0
    cursor.execute('''select count(*) as seen from math_mate.learning_events
        where learner_id = %s and misconception_id = %s and kind = 'misconception_observed' ''',
        (learner_id, misconception_id))
    return cursor.fetchone()['seen']


def learner_card(cursor, learner_id, context):
    """At most four short lines for the tutor. Never shown to the Marker."""
    known, items = catalogue.outcomes(), catalogue.misconceptions()
    cursor.execute('''select outcome_code, mastery, confidence, attempts from math_mate.learner_outcome_state
        where learner_id = %s and outcome_code = any(%s)''', (learner_id, list(context.candidate_outcomes)))
    states = {row['outcome_code']: row for row in cursor.fetchall()}
    parts = []
    for code in context.candidate_outcomes:
        row = states.get(code)
        if row and float(row['confidence']) >= 0.3:
            value = float(row['mastery'])
            label = 'strong' if value >= 0.75 else 'developing' if value >= 0.5 else 'weak'
            parts.append(f'{known[code].text}: {label} ({row["attempts"]} attempts)')
        else:
            parts.append(f'{known[code].text}: not enough practice yet')
    lines = ['; '.join(parts[:3])] if parts else []
    cursor.execute('''select misconception_id,
            count(*) filter (where kind = 'misconception_observed') as seen,
            count(*) filter (where kind = 'misconception_resolved') as fixed
        from math_mate.learning_events
        where learner_id = %s and misconception_id is not null and created_at > now() - interval '90 days'
        group by misconception_id
        having count(*) filter (where kind = 'misconception_observed') > count(*) filter (where kind = 'misconception_resolved')
        order by seen desc limit 2''', (learner_id,))
    for row in cursor.fetchall():
        if row['misconception_id'] in items:
            lines.append(f'Recurring difficulty: {items[row["misconception_id"]].description} (seen {row["seen"]} times).')
    cursor.execute('''select round(avg(max_assistance)) as level from (select max_assistance from math_mate.tutor_sessions
        where learner_id = %s and state <> 'active' order by updated_at desc limit 5) recent''', (learner_id,))
    level = cursor.fetchone()['level']
    if level is not None:
        lines.append(f'On recent finished questions this student needed help up to level {int(level)} of 5.')
    return '\n'.join(lines[:4])
