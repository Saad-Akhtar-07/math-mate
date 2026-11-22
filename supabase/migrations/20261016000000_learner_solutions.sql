-- Keep curated JSON authoritative; project only leaf identities for foreign keys.
create table math_mate.question_parts (
    id text primary key,
    question_id text not null references math_mate.questions(id) on delete restrict,
    active boolean not null default true
);
create index question_parts_question_idx on math_mate.question_parts(question_id);

create function math_mate.sync_question_parts() returns trigger
language plpgsql set search_path = pg_catalog, math_mate as $$
declare leaf_ids text[];
begin
    with recursive parts as (
        select value as part from jsonb_array_elements(
            case when jsonb_array_length(coalesce(new.question_data->'parts', '[]')) > 0
                then new.question_data->'parts'
                else jsonb_build_array(jsonb_build_object('id', new.id || '-main')) end)
        union all
        select child.value from parts p,
            lateral jsonb_array_elements(coalesce(p.part->'parts', '[]')) child
    )
    select array_agg(part->>'id') into leaf_ids from parts
    where jsonb_array_length(coalesce(part->'parts', '[]')) = 0;
    if exists (select 1 from math_mate.question_parts
               where id = any(leaf_ids) and question_id <> new.id) then
        raise exception 'Question part identity collision';
    end if;
    update math_mate.question_parts set active = false where question_id = new.id;
    insert into math_mate.question_parts(id, question_id, active)
    select unnest(leaf_ids), new.id, true
    on conflict (id) do update set active = true
    where question_parts.question_id = excluded.question_id;
    return new;
end;
$$;
create trigger questions_sync_parts after insert or update of question_data
    on math_mate.questions for each row execute function math_mate.sync_question_parts();
-- Backfill existing questions using the same projection as future imports.
update math_mate.questions set question_data = question_data;

create table math_mate.learners (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now()
);
create table math_mate.learner_sessions (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    token_hash text not null unique check (length(token_hash) = 64),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '90 days'),
    check (expires_at > created_at)
);
create index learner_sessions_learner_idx on math_mate.learner_sessions(learner_id);
create index learner_sessions_expiry_idx on math_mate.learner_sessions(expires_at);

create table math_mate.student_responses (
    id uuid primary key default gen_random_uuid(),
    learner_id uuid not null references math_mate.learners(id) on delete cascade,
    question_part_id text not null references math_mate.question_parts(id) on delete restrict,
    typed_work text not null default '' check (char_length(typed_work) <= 20000),
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (learner_id, question_part_id)
);
create index student_responses_part_idx on math_mate.student_responses(question_part_id);

-- A submission is a snapshot, not a flag on a mutable draft. Autosave never
-- creates attempts, and retries of the same revision return the same submission.
create table math_mate.response_submissions (
    id uuid primary key default gen_random_uuid(),
    response_id uuid not null references math_mate.student_responses(id) on delete cascade,
    response_revision integer not null check (response_revision > 0),
    typed_work text not null check (char_length(typed_work) between 1 and 20000 and length(btrim(typed_work)) > 0),
    question_snapshot jsonb not null check (jsonb_typeof(question_snapshot) = 'object'),
    submitted_at timestamptz not null default now(),
    unique (response_id, response_revision)
);

-- Defense in depth: only the server database role may access this private schema.
alter table math_mate.question_parts enable row level security;
alter table math_mate.learners enable row level security;
alter table math_mate.learner_sessions enable row level security;
alter table math_mate.student_responses enable row level security;
alter table math_mate.response_submissions enable row level security;
revoke all on all tables in schema math_mate from public, anon, authenticated;
revoke all on function math_mate.sync_question_parts() from public;

comment on table math_mate.learners is 'Stable ownership identity; future accounts can be linked without changing response ownership.';
comment on table math_mate.learner_sessions is 'Guest bearer credentials: SHA-256 hashes only, never raw tokens.';
comment on table math_mate.question_parts is 'Leaf ID projection of question_data; removed parts remain inactive to preserve learner history.';
comment on table math_mate.response_submissions is 'Append-only through the API; one immutable attempt per saved revision, with student-safe question snapshot.';
