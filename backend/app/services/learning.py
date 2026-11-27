"""Record learning evidence and maintain the mastery projection inside the caller's transaction.

Each statement is a network round trip, so evidence is written and read in
batches: one insert for all events, then a fixed number of statements however
many outcomes an assessment touches.
"""

from ..tutoring import bkt, catalogue
from ..tutoring.learner_model import FORMULA_VERSION, DEFAULT_PRIOR, assessment_evidence, mastery, resolution_evidence


def insert_events(cursor, user_id, part_id, source_kind, source_id, events):
    if not events:
        return 0
    # The unique index makes recording the same source twice a no-op.
    cursor.execute('''insert into math_mate.learning_events
        (user_id, question_part_id, outcome_code, kind, score, weight, misconception_id, source_kind, source_id)
        select %s, %s, e.outcome_code, e.kind, e.score, e.weight, e.misconception_id, %s, %s
        from unnest(%s::text[], %s::text[], %s::numeric[], %s::numeric[], %s::text[])
            as e(outcome_code, kind, score, weight, misconception_id)
        on conflict do nothing returning id''',
        (user_id, part_id, source_kind, source_id,
         [event.outcome_code for event in events], [event.kind for event in events],
         [event.score for event in events], [event.weight for event in events],
         [event.misconception_id for event in events]))
    return len(cursor.fetchall())


def refresh_outcomes(cursor, user_id, codes):
    known = catalogue.outcomes()
    codes = sorted(codes)
    siblings = {code: [item.code for item in known.values()
                       if item.subtopic == catalogue.subtopic_of(code) and item.code != code] for code in codes}
    cursor.execute('''select outcome_code, score, weight, created_at from math_mate.learning_events
        where user_id = %s and outcome_code = any(%s) and kind = 'attempt' ''', (user_id, codes))
    attempts = {}
    for row in cursor.fetchall():
        attempts.setdefault(row['outcome_code'], []).append((row['score'], row['weight'], row['created_at']))
    cursor.execute('''select outcome_code, mastery from math_mate.user_outcome_state
        where user_id = %s and outcome_code = any(%s)''',
        (user_id, sorted({code for group in siblings.values() for code in group})))
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
    cursor.execute('''insert into math_mate.user_outcome_state
        (user_id, outcome_code, mastery, confidence, evidence_weight, attempts, independent_full_marks,
         last_evidence_at, formula_version)
        select %s, r.*, %s from unnest(%s::text[], %s::numeric[], %s::numeric[], %s::numeric[], %s::int[], %s::int[],
            %s::timestamptz[]) as r
        on conflict (user_id, outcome_code) do update set mastery = excluded.mastery,
            confidence = excluded.confidence, evidence_weight = excluded.evidence_weight,
            attempts = excluded.attempts, independent_full_marks = excluded.independent_full_marks,
            last_evidence_at = excluded.last_evidence_at, formula_version = excluded.formula_version,
            updated_at = now()''',
        (user_id, FORMULA_VERSION, *[list(column) for column in columns]))


def record_standard_bkt_baseline(cursor, user_id, part_id, assessment_id, events):
    """Forecast and update the standard independent-only BKT baseline."""
    attempts = [event for event in events if event.kind == 'attempt']
    if not attempts:
        return
    codes = sorted({event.outcome_code for event in attempts})
    known = catalogue.outcomes()
    siblings = {code: [item.code for item in known.values()
                       if item.subtopic == catalogue.subtopic_of(code) and item.code != code] for code in codes}
    related = sorted({*codes, *(item for group in siblings.values() for item in group)})
    cursor.execute('''select outcome_code, mastery, attempts from math_mate.user_outcome_state
        where user_id = %s and outcome_code = any(%s)''', (user_id, related))
    weighted = {row['outcome_code']: row for row in cursor.fetchall()}
    cursor.execute('''select outcome_code, mastery, evidence_count from math_mate.bkt_states
        where user_id = %s and model_version = %s and outcome_code = any(%s) for update''',
        (user_id, bkt.MODEL_VERSION, codes))
    shadow = {row['outcome_code']: row for row in cursor.fetchall()}

    prediction_rows, state_rows = [], []
    for event in attempts:
        code = event.outcome_code
        current_weighted = weighted.get(code)
        if current_weighted:
            weighted_prediction = float(current_weighted['mastery'])
            weighted_count = current_weighted['attempts']
        else:
            sibling_values = [float(weighted[item]['mastery']) for item in siblings[code] if item in weighted]
            weighted_prediction = sum(sibling_values) / len(sibling_values) if sibling_values else DEFAULT_PRIOR
            weighted_count = 0
        current_bkt = shadow.get(code)
        mastery_before = float(current_bkt['mastery']) if current_bkt else bkt.BASELINE.initial_mastery
        evidence_before = current_bkt['evidence_count'] if current_bkt else 0
        correct = float(event.score) == 1.0
        mastery_after = bkt.update(mastery_before, correct)
        prediction_rows.append((code, correct, weighted_prediction, weighted_count,
                                bkt.probability_correct(mastery_before), mastery_before, mastery_after, evidence_before))
        state_rows.append((code, mastery_after, evidence_before + 1))

    columns = list(zip(*prediction_rows))
    cursor.execute('''insert into math_mate.learner_model_predictions
        (user_id, question_part_id, assessment_id, outcome_code, observed_correct,
         weighted_prediction, weighted_evidence_count, weighted_model_version,
         bkt_prediction, bkt_mastery_before, bkt_mastery_after, bkt_evidence_count_before, bkt_model_version)
        select %(user)s, %(part)s, %(assessment)s, r.outcome_code, r.correct,
            r.weighted_prediction, r.weighted_count, %(weighted_version)s,
            r.bkt_prediction, r.mastery_before, r.mastery_after, r.evidence_before, %(bkt_version)s
        from unnest(%(codes)s::text[], %(correct)s::boolean[], %(weighted)s::numeric[], %(weighted_count)s::int[],
                    %(bkt_prediction)s::numeric[], %(before)s::numeric[], %(after)s::numeric[], %(evidence)s::int[])
            as r(outcome_code, correct, weighted_prediction, weighted_count,
                 bkt_prediction, mastery_before, mastery_after, evidence_before)
        on conflict (assessment_id, outcome_code, bkt_model_version) do nothing''', {
            'user': user_id, 'part': part_id, 'assessment': assessment_id,
            'weighted_version': FORMULA_VERSION, 'bkt_version': bkt.MODEL_VERSION,
            'codes': list(columns[0]), 'correct': list(columns[1]), 'weighted': list(columns[2]),
            'weighted_count': list(columns[3]), 'bkt_prediction': list(columns[4]),
            'before': list(columns[5]), 'after': list(columns[6]), 'evidence': list(columns[7]),
        })
    state_columns = list(zip(*state_rows))
    cursor.execute('''insert into math_mate.bkt_states
        (user_id, outcome_code, model_version, mastery, evidence_count, last_evidence_at)
        select %s, r.outcome_code, %s, r.mastery, r.evidence_count, now()
        from unnest(%s::text[], %s::numeric[], %s::int[]) as r(outcome_code, mastery, evidence_count)
        on conflict (user_id, outcome_code, model_version) do update set mastery = excluded.mastery,
            evidence_count = excluded.evidence_count, last_evidence_at = excluded.last_evidence_at, updated_at = now()''',
        (user_id, bkt.MODEL_VERSION, *[list(column) for column in state_columns]))


def attempt_context(independent, solution_shown):
    if solution_shown:
        return bkt.AFTER_SOLUTION
    return bkt.INDEPENDENT if independent else bkt.ASSISTED


def context_from_weight(weight):
    """Recover the stable three-way context from append-only historical evidence."""
    value = float(weight)
    if value >= 0.75:
        return bkt.INDEPENDENT
    if value <= 0.375:
        return bkt.AFTER_SOLUTION
    return bkt.ASSISTED


def elapsed_days(previous, current):
    if previous is None:
        return None
    return max(0.0, (current - previous).total_seconds() / 86400)


def replay_context_history(rows):
    """Build a contextual state from earlier immutable learning events."""
    mastery_value = bkt.CONTEXT_BASELINE.initial_mastery
    count, last_evidence_at = 0, None
    for row in rows:
        update = bkt.contextual_update(
            mastery_value, float(row['score']) == 1.0, context_from_weight(row['weight']),
            elapsed_days(last_evidence_at, row['created_at']))
        mastery_value = update.mastery_after
        count += 1
        last_evidence_at = row['created_at']
    return mastery_value, count, last_evidence_at


def weighted_forecasts(cursor, user_id, codes):
    known = catalogue.outcomes()
    siblings = {code: [item.code for item in known.values()
                       if item.subtopic == catalogue.subtopic_of(code) and item.code != code] for code in codes}
    related = sorted({*codes, *(item for group in siblings.values() for item in group)})
    cursor.execute('''select outcome_code, mastery, attempts from math_mate.user_outcome_state
        where user_id = %s and outcome_code = any(%s)''', (user_id, related))
    states = {row['outcome_code']: row for row in cursor.fetchall()}
    forecasts = {}
    for code in codes:
        current = states.get(code)
        if current:
            forecasts[code] = float(current['mastery']), current['attempts']
        else:
            sibling_values = [float(states[item]['mastery']) for item in siblings[code] if item in states]
            forecasts[code] = (sum(sibling_values) / len(sibling_values) if sibling_values else DEFAULT_PRIOR), 0
    return forecasts


def record_context_bkt(cursor, user_id, part_id, assessment_id, events, context_name):
    """Update active contextual BKT; score independent work for evaluation.

    The first update for a user/outcome lazily replays earlier append-only events.
    This gives the evolved model the same historical starting opportunity as the
    weighted projection without manufacturing retrospective predictions.
    """
    attempts = [event for event in events if event.kind == 'attempt']
    if not attempts:
        return
    codes = sorted({event.outcome_code for event in attempts})
    cursor.execute('''select outcome_code, created_at from math_mate.learning_events
        where user_id = %s and source_kind = 'assessment' and source_id = %s
            and kind = 'attempt' and outcome_code = any(%s)''', (user_id, assessment_id, codes))
    current_times = {row['outcome_code']: row['created_at'] for row in cursor.fetchall()}
    cursor.execute('''select outcome_code, mastery, evidence_count, last_evidence_at
        from math_mate.bkt_states
        where user_id = %s and model_version = %s and outcome_code = any(%s) for update''',
        (user_id, bkt.CONTEXT_MODEL_VERSION, codes))
    shadow = {row['outcome_code']: row for row in cursor.fetchall()}

    missing = [code for code in codes if code not in shadow]
    history = {code: [] for code in missing}
    if missing:
        cursor.execute('''select outcome_code, score, weight, created_at
            from math_mate.learning_events
            where user_id = %s and kind = 'attempt' and outcome_code = any(%s)
                and not (source_kind = 'assessment' and source_id = %s)
            order by created_at, id''', (user_id, missing, assessment_id))
        for row in cursor.fetchall():
            if row['created_at'] < current_times[row['outcome_code']]:
                history[row['outcome_code']].append(row)

    weighted = weighted_forecasts(cursor, user_id, codes) if context_name == bkt.INDEPENDENT else {}
    event_by_code = {event.outcome_code: event for event in attempts}
    prediction_rows, update_rows, state_rows = [], [], []
    for code in codes:
        current = shadow.get(code)
        if current:
            mastery_before = float(current['mastery'])
            evidence_before = current['evidence_count']
            last_evidence_at = current['last_evidence_at']
        else:
            mastery_before, evidence_before, last_evidence_at = replay_context_history(history[code])
        current_at = current_times[code]
        days = elapsed_days(last_evidence_at, current_at)
        correct = float(event_by_code[code].score) == 1.0
        update = bkt.contextual_update(mastery_before, correct, context_name, days)
        if context_name == bkt.INDEPENDENT:
            weighted_prediction, weighted_count = weighted[code]
            prediction_rows.append((
                code, correct, weighted_prediction, weighted_count,
                bkt.context_probability_correct(update.mastery_after_forgetting),
                update.mastery_before, update.mastery_after, evidence_before))
        update_rows.append((
            code, correct, update.observation_used, days, update.forgetting_bucket,
            update.forget_probability, update.mastery_before, update.mastery_after_forgetting,
            update.mastery_after_observation, update.mastery_after, evidence_before))
        state_rows.append((code, update.mastery_after, evidence_before + 1, current_at))

    if prediction_rows:
        columns = list(zip(*prediction_rows))
        cursor.execute('''insert into math_mate.learner_model_predictions
            (user_id, question_part_id, assessment_id, outcome_code, observed_correct,
             weighted_prediction, weighted_evidence_count, weighted_model_version,
             bkt_prediction, bkt_mastery_before, bkt_mastery_after, bkt_evidence_count_before, bkt_model_version)
            select %(user)s, %(part)s, %(assessment)s, r.outcome_code, r.correct,
                r.weighted_prediction, r.weighted_count, %(weighted_version)s,
                r.bkt_prediction, r.mastery_before, r.mastery_after, r.evidence_before, %(bkt_version)s
            from unnest(%(codes)s::text[], %(correct)s::boolean[], %(weighted)s::numeric[], %(weighted_count)s::int[],
                        %(bkt_prediction)s::numeric[], %(before)s::numeric[], %(after)s::numeric[], %(evidence)s::int[])
                as r(outcome_code, correct, weighted_prediction, weighted_count,
                     bkt_prediction, mastery_before, mastery_after, evidence_before)
            on conflict (assessment_id, outcome_code, bkt_model_version) do nothing''', {
                'user': user_id, 'part': part_id, 'assessment': assessment_id,
                'weighted_version': FORMULA_VERSION, 'bkt_version': bkt.CONTEXT_MODEL_VERSION,
                'codes': list(columns[0]), 'correct': list(columns[1]), 'weighted': list(columns[2]),
                'weighted_count': list(columns[3]), 'bkt_prediction': list(columns[4]),
                'before': list(columns[5]), 'after': list(columns[6]), 'evidence': list(columns[7]),
            })

    columns = list(zip(*update_rows))
    cursor.execute('''insert into math_mate.bkt_updates
        (user_id, question_part_id, assessment_id, outcome_code, model_version, attempt_context,
         observed_correct, observation_used, elapsed_days, forgetting_bucket, forget_probability,
         mastery_before, mastery_after_forgetting, mastery_after_observation, mastery_after, evidence_count_before)
        select %(user)s, %(part)s, %(assessment)s, r.outcome_code, %(version)s, %(context)s,
            r.correct, r.observation_used, r.elapsed_days, r.forgetting_bucket, r.forget_probability,
            r.mastery_before, r.after_forgetting, r.after_observation, r.mastery_after, r.evidence_before
        from unnest(%(codes)s::text[], %(correct)s::boolean[], %(observation_used)s::boolean[],
                    %(elapsed_days)s::numeric[], %(buckets)s::text[], %(forget)s::numeric[],
                    %(before)s::numeric[], %(after_forgetting)s::numeric[], %(after_observation)s::numeric[],
                    %(after)s::numeric[], %(evidence)s::int[])
            as r(outcome_code, correct, observation_used, elapsed_days, forgetting_bucket, forget_probability,
                 mastery_before, after_forgetting, after_observation, mastery_after, evidence_before)
        on conflict (assessment_id, outcome_code, model_version) do nothing''', {
            'user': user_id, 'part': part_id, 'assessment': assessment_id,
            'version': bkt.CONTEXT_MODEL_VERSION, 'context': context_name,
            'codes': list(columns[0]), 'correct': list(columns[1]), 'observation_used': list(columns[2]),
            'elapsed_days': list(columns[3]), 'buckets': list(columns[4]), 'forget': list(columns[5]),
            'before': list(columns[6]), 'after_forgetting': list(columns[7]),
            'after_observation': list(columns[8]), 'after': list(columns[9]), 'evidence': list(columns[10]),
        })
    columns = list(zip(*state_rows))
    cursor.execute('''insert into math_mate.bkt_states
        (user_id, outcome_code, model_version, mastery, evidence_count, last_evidence_at)
        select %s, r.outcome_code, %s, r.mastery, r.evidence_count, r.last_evidence_at
        from unnest(%s::text[], %s::numeric[], %s::int[], %s::timestamptz[])
            as r(outcome_code, mastery, evidence_count, last_evidence_at)
        on conflict (user_id, outcome_code, model_version) do update set mastery = excluded.mastery,
            evidence_count = excluded.evidence_count, last_evidence_at = excluded.last_evidence_at, updated_at = now()''',
        (user_id, bkt.CONTEXT_MODEL_VERSION, *[list(column) for column in columns]))


def record_assessment(cursor, user_id, part_id, assessment_id, context, mark_result, independent, solution_shown):
    events = assessment_evidence(context, mark_result, independent, solution_shown)
    # Serialize projections for one user so simultaneous completed assessments cannot lose an update.
    cursor.execute('select 1 from math_mate.users where id = %s for update', (user_id,))
    if insert_events(cursor, user_id, part_id, 'assessment', assessment_id, events):
        if independent and not solution_shown:
            # These run before refresh_outcomes, so every forecast uses only earlier evidence.
            record_standard_bkt_baseline(cursor, user_id, part_id, assessment_id, events)
        record_context_bkt(cursor, user_id, part_id, assessment_id, events,
                           attempt_context(independent, solution_shown))
        refresh_outcomes(cursor, user_id, {event.outcome_code for event in events if event.kind == 'attempt'})


def record_resolution(cursor, user_id, part_id, session_id):
    # Misconceptions seen on this part since the session began are resolved by a full-mark resubmission.
    cursor.execute('''select distinct outcome_code, misconception_id from math_mate.learning_events
        where user_id = %s and question_part_id = %s and kind = 'misconception_observed'
            and created_at >= (select created_at from math_mate.tutor_sessions where id = %s)''',
        (user_id, part_id, session_id))
    observed = [(row['outcome_code'], row['misconception_id']) for row in cursor.fetchall()]
    insert_events(cursor, user_id, part_id, 'tutor_session', session_id, resolution_evidence(observed))


def tutor_profile(cursor, user_id, codes):
    """Active contextual-BKT mastery plus misconception/help memory in one read.

    Forgetting is projected at read time without mutating stored state. Only
    Marker attempt observations (independent or assisted, not a shown solution)
    contribute to confidence in personalization.
    """
    cursor.execute('''select
        (select coalesce(jsonb_object_agg(outcome_code, jsonb_build_object(
                'mastery', mastery, 'attempts', evidence_count,
                'elapsed_days', greatest(0, extract(epoch from (now() - last_evidence_at)) / 86400))), '{}')
            from math_mate.bkt_states
            where user_id = %(user)s and model_version = %(model)s
                and outcome_code = any(%(codes)s)) as states,
        (select coalesce(jsonb_object_agg(outcome_code, observations), '{}') from (
            select outcome_code, count(*) as observations from math_mate.learning_events
            where user_id = %(user)s and kind = 'attempt' and weight >= 0.5
                and outcome_code = any(%(codes)s)
            group by outcome_code) diagnostic) as observation_counts,
        (select coalesce(jsonb_object_agg(misconception_id, seen), '{}') from (
            select misconception_id, count(*) as seen from math_mate.learning_events
            where user_id = %(user)s and kind = 'misconception_observed'
            group by misconception_id) counts) as misconceptions_seen,
        (select coalesce(jsonb_agg(jsonb_build_object('id', misconception_id, 'seen', seen) order by seen desc), '[]') from (
            select misconception_id, count(*) filter (where kind = 'misconception_observed') as seen
            from math_mate.learning_events
            where user_id = %(user)s and misconception_id is not null and created_at > now() - interval '90 days'
            group by misconception_id
            having count(*) filter (where kind = 'misconception_observed') > count(*) filter (where kind = 'misconception_resolved')
            order by seen desc limit 2) recurring) as recurring,
        (select round(avg(max_assistance)) from (select max_assistance from math_mate.tutor_sessions
            where user_id = %(user)s and state <> 'active' order by updated_at desc limit 5) recent) as help_level''',
        {'user': user_id, 'codes': list(codes), 'model': bkt.CONTEXT_MODEL_VERSION})
    profile = cursor.fetchone()
    counts = profile.pop('observation_counts')
    for code, state in profile['states'].items():
        current, _, _ = bkt.apply_forgetting(float(state['mastery']), float(state.pop('elapsed_days')))
        state['mastery'] = round(current, 6)
        state['confidence'] = bkt.evidence_confidence(counts.get(code, 0))
    return profile


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
