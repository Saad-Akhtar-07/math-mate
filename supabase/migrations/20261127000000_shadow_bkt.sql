-- Evaluate a baseline Bayesian Knowledge Tracing model without changing the
-- active weighted learner model or tutor policy. Only independent, marked
-- attempts enter this shadow state.

create table math_mate.bkt_shadow_states (
    user_id uuid not null references math_mate.users(id) on delete cascade,
    outcome_code text not null check (outcome_code ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    model_version text not null check (length(model_version) between 1 and 100),
    mastery numeric(7, 6) not null check (mastery between 0 and 1),
    evidence_count integer not null check (evidence_count >= 0),
    last_evidence_at timestamptz not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, outcome_code, model_version)
);

-- Each row is a genuine forecast made before the corresponding independent
-- observation was used to update either projection. evidence_count_before = 0
-- is cold start; larger values are the personalized follow-up evaluation set.
create table math_mate.learner_model_predictions (
    id bigint generated always as identity primary key,
    user_id uuid not null references math_mate.users(id) on delete cascade,
    question_part_id text not null references math_mate.question_parts(id) on delete restrict,
    assessment_id uuid not null references math_mate.assessments(id) on delete cascade,
    outcome_code text not null check (outcome_code ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    observed_correct boolean not null,
    weighted_prediction numeric(7, 6) not null check (weighted_prediction between 0 and 1),
    weighted_evidence_count integer not null check (weighted_evidence_count >= 0),
    weighted_model_version text not null check (length(weighted_model_version) between 1 and 100),
    bkt_prediction numeric(7, 6) not null check (bkt_prediction between 0 and 1),
    bkt_mastery_before numeric(7, 6) not null check (bkt_mastery_before between 0 and 1),
    bkt_mastery_after numeric(7, 6) not null check (bkt_mastery_after between 0 and 1),
    bkt_evidence_count_before integer not null check (bkt_evidence_count_before >= 0),
    bkt_model_version text not null check (length(bkt_model_version) between 1 and 100),
    created_at timestamptz not null default now(),
    unique (assessment_id, outcome_code, bkt_model_version)
);
create index learner_model_predictions_user_outcome_idx
    on math_mate.learner_model_predictions(user_id, outcome_code, created_at);

alter table math_mate.bkt_shadow_states enable row level security;
alter table math_mate.learner_model_predictions enable row level security;
revoke all on math_mate.bkt_shadow_states, math_mate.learner_model_predictions
    from public, anon, authenticated;

comment on table math_mate.bkt_shadow_states is
    'Rebuildable BKT shadow projection from independent marked attempts; never read by the live tutor.';
comment on table math_mate.learner_model_predictions is
    'Pre-observation weighted and BKT forecasts for offline comparison; no student work or model prompts.';
