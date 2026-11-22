-- AI marking, tutoring and learner evidence. Model output is validated by the
-- backend before it is stored; marks are never changed by tutor conversation.

-- One Marker result per immutable submission and pipeline version.
create table math_mate.assessments (
    id uuid primary key default gen_random_uuid(),
    submission_id uuid not null references math_mate.response_submissions(id) on delete cascade,
    pipeline_version text not null check (length(pipeline_version) between 1 and 200),
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'completed', 'unreadable', 'failed')),
    run_count smallint not null default 0 check (run_count between 0 and 2),
    independent boolean not null,
    marks_awarded smallint,
    marks_maximum smallint not null check (marks_maximum >= 0),
    result jsonb check (result is null or jsonb_typeof(result) = 'object'),
    feedback text check (char_length(feedback) <= 600),
    error_code text check (error_code is null or error_code in
        ('timeout', 'provider_unavailable', 'rejected', 'invalid_output', 'truncated', 'budget', 'interrupted', 'storage', 'internal')),
    prompt_version text,
    model text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    unique (submission_id, pipeline_version),
    check (marks_awarded is null or marks_awarded between 0 and marks_maximum),
    check ((status = 'completed') = (marks_awarded is not null))
);
create index assessments_unfinished_idx on math_mate.assessments(updated_at)
    where status in ('pending', 'processing');

-- The tutoring loop for one learner and question part. A session may start
-- before the first submission, so its assessment is optional.
create table math_mate.tutor_sessions (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    question_part_id text not null references math_mate.question_parts(id) on delete restrict,
    current_assessment_id uuid references math_mate.assessments(id) on delete set null,
    state text not null default 'active' check (state in ('active', 'resolved', 'resolved_with_solution')),
    mistake_index smallint not null default 0 check (mistake_index >= 0),
    level smallint not null default 0 check (level between 0 and 5),
    max_assistance smallint not null default 0 check (max_assistance between 0 and 5),
    no_progress_streak smallint not null default 0 check (no_progress_streak >= 0),
    turn_count smallint not null default 0 check (turn_count >= 0),
    solution_shown boolean not null default false,
    policy_version text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    ended_at timestamptz,
    check ((state = 'active') = (ended_at is null))
);
create unique index tutor_sessions_one_active_idx on math_mate.tutor_sessions(learner_id, question_part_id)
    where state = 'active';
create index tutor_sessions_learner_part_idx on math_mate.tutor_sessions(learner_id, question_part_id, created_at);

-- One learner message and one tutor reply, including the policy decision log.
create table math_mate.tutor_turns (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references math_mate.tutor_sessions(id) on delete cascade,
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    client_message_id uuid not null,
    intent text not null check (intent in ('message', 'hint', 'explain', 'show_step')),
    learner_message text not null check (char_length(learner_message) between 1 and 1000),
    observation jsonb check (observation is null or jsonb_typeof(observation) = 'object'),
    decision_state jsonb check (decision_state is null or jsonb_typeof(decision_state) = 'object'),
    teaching_move text,
    assistance smallint check (assistance between 0 and 5),
    reason text,
    tutor_message text check (char_length(tutor_message) <= 2000),
    status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
    run_count smallint not null default 1 check (run_count between 1 and 2),
    error_code text check (error_code is null or error_code in
        ('timeout', 'provider_unavailable', 'rejected', 'invalid_output', 'truncated', 'budget', 'interrupted', 'internal')),
    policy_version text,
    prompt_version text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (learner_id, client_message_id),
    check ((status = 'completed') = (tutor_message is not null and teaching_move is not null))
);
create index tutor_turns_session_idx on math_mate.tutor_turns(session_id, created_at);
create index tutor_turns_processing_idx on math_mate.tutor_turns(updated_at) where status = 'processing';

-- Append-only learning evidence. Mastery is a projection of these rows.
create table math_mate.learning_events (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    question_part_id text not null references math_mate.question_parts(id) on delete restrict,
    outcome_code text not null check (outcome_code ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    kind text not null check (kind in ('attempt', 'misconception_observed', 'misconception_resolved')),
    score numeric(4, 3) check (score between 0 and 1),
    weight numeric(4, 3) check (weight > 0 and weight <= 1),
    misconception_id text check (misconception_id is null or length(misconception_id) between 1 and 80),
    source_kind text not null check (source_kind in ('assessment', 'tutor_session')),
    source_id uuid not null,
    created_at timestamptz not null default now(),
    check ((kind = 'attempt') = (score is not null and weight is not null)),
    check ((kind = 'attempt') = (misconception_id is null))
);
-- Recording the same assessment or session twice can never count twice.
create unique index learning_events_once_idx on math_mate.learning_events
    (source_kind, source_id, outcome_code, kind, coalesce(misconception_id, ''));
create index learning_events_learner_outcome_idx on math_mate.learning_events(learner_id, outcome_code, created_at);

-- Rebuildable projection of learning_events, one row per learner and outcome.
create table math_mate.learner_outcome_state (
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    outcome_code text not null check (outcome_code ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    mastery numeric(4, 3) not null check (mastery between 0 and 1),
    confidence numeric(4, 3) not null check (confidence between 0 and 1),
    evidence_weight numeric(8, 3) not null check (evidence_weight >= 0),
    attempts integer not null check (attempts >= 0),
    independent_full_marks integer not null check (independent_full_marks >= 0),
    last_evidence_at timestamptz not null,
    formula_version text not null,
    updated_at timestamptz not null default now(),
    primary key (learner_id, outcome_code)
);

-- Paid-model usage ledger. Never stores prompts, student work, keys or URLs.
-- A call is reserved at its worst-case cost before the request and settled afterwards.
create table math_mate.llm_calls (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    purpose text not null check (purpose in ('marker', 'observer', 'composer', 'smoke')),
    provider text not null,
    model text not null,
    prompt_version text,
    status text not null check (status in
        ('pending', 'ok', 'timeout', 'provider_unavailable', 'rejected', 'invalid_output', 'truncated', 'budget_blocked')),
    learner_id uuid references math_mate.learners(id) on delete set null,
    source_id uuid,
    cache_hit_tokens integer not null default 0 check (cache_hit_tokens >= 0),
    cache_miss_tokens integer not null default 0 check (cache_miss_tokens >= 0),
    completion_tokens integer not null default 0 check (completion_tokens >= 0),
    reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
    latency_ms integer not null default 0 check (latency_ms >= 0),
    cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0)
);
create index llm_calls_created_idx on math_mate.llm_calls(created_at);
create index llm_calls_learner_created_idx on math_mate.llm_calls(learner_id, created_at);

alter table math_mate.assessments enable row level security;
alter table math_mate.tutor_sessions enable row level security;
alter table math_mate.tutor_turns enable row level security;
alter table math_mate.learning_events enable row level security;
alter table math_mate.learner_outcome_state enable row level security;
alter table math_mate.llm_calls enable row level security;
revoke all on all tables in schema math_mate from public, anon, authenticated;

comment on table math_mate.assessments is 'Validated Marker result per submission and pipeline version; retries return the same row.';
comment on table math_mate.tutor_sessions is 'Tutoring loop state per learner and part; at most one active session per part.';
comment on table math_mate.tutor_turns is 'Learner message, tutor reply and the policy decision that produced it; idempotent by client_message_id.';
comment on table math_mate.learning_events is 'Append-only evidence keyed by official learning outcome codes.';
comment on table math_mate.learner_outcome_state is 'Mastery projection rebuilt from learning_events; formula_version records the formula used.';
comment on table math_mate.llm_calls is 'Paid AI usage ledger for budget enforcement. No prompts, student content, keys or URLs.';
