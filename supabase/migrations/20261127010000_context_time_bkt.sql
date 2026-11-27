-- First evolution of the BKT shadow experiment. Contextual BKT learns from
-- independent, assisted and after-solution opportunities, applies versioned
-- time-bucket forgetting, and remains isolated from the live tutor policy.

create table math_mate.bkt_shadow_updates (
    id bigint generated always as identity primary key,
    user_id uuid not null references math_mate.users(id) on delete cascade,
    question_part_id text not null references math_mate.question_parts(id) on delete restrict,
    assessment_id uuid not null references math_mate.assessments(id) on delete cascade,
    outcome_code text not null check (outcome_code ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    model_version text not null check (length(model_version) between 1 and 100),
    attempt_context text not null check (attempt_context in ('independent', 'assisted', 'after_solution')),
    observed_correct boolean not null,
    observation_used boolean not null,
    elapsed_days numeric(12, 6) check (elapsed_days is null or elapsed_days >= 0),
    forgetting_bucket text not null check (forgetting_bucket in
        ('0_15_days', '16_30_days', '31_60_days', 'over_60_days')),
    forget_probability numeric(7, 6) not null check (forget_probability between 0 and 1),
    mastery_before numeric(7, 6) not null check (mastery_before between 0 and 1),
    mastery_after_forgetting numeric(7, 6) not null check (mastery_after_forgetting between 0 and 1),
    mastery_after_observation numeric(7, 6) not null check (mastery_after_observation between 0 and 1),
    mastery_after numeric(7, 6) not null check (mastery_after between 0 and 1),
    evidence_count_before integer not null check (evidence_count_before >= 0),
    created_at timestamptz not null default now(),
    unique (assessment_id, outcome_code, model_version)
);
create index bkt_shadow_updates_user_outcome_idx
    on math_mate.bkt_shadow_updates(user_id, outcome_code, created_at);

alter table math_mate.bkt_shadow_updates enable row level security;
revoke all on math_mate.bkt_shadow_updates from public, anon, authenticated;

comment on table math_mate.bkt_shadow_updates is
    'Auditable context, forgetting and mastery transitions for versioned BKT shadow models; never read by the live tutor.';

comment on table math_mate.bkt_shadow_states is
    'Rebuildable versioned BKT shadow projections; standard and contextual models remain isolated from the live tutor.';

comment on table math_mate.learner_model_predictions is
    'Pre-observation weighted and BKT forecasts scored on independent marked attempts; no student work or model prompts.';
