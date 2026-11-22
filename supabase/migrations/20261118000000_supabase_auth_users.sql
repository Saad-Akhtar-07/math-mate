-- Supabase Auth is the only identity provider. This is an intentional clean
-- reset of pre-launch guest activity. Curated questions and question_parts are
-- not deleted.

-- TRUNCATE CASCADE clears guest sessions, drafts, submissions, attachments,
-- assessments, tutoring, learning memory and the per-user AI usage ledger.
-- Run backend.scripts.reset_user_data --apply before this migration so private
-- Storage objects are deleted while their object keys are still available.
truncate table math_mate.learners cascade;

alter table math_mate.learners rename to users;
alter table math_mate.users alter column id drop default;
alter table math_mate.users add column auth_user_id uuid;
alter table math_mate.users add constraint users_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users(id) on delete cascade;
alter table math_mate.users add constraint users_auth_id_matches_user_id
    check (auth_user_id is null or auth_user_id = id);
create unique index users_auth_user_id_idx on math_mate.users(auth_user_id)
    where auth_user_id is not null;

-- Custom browser sessions are replaced by Supabase access and refresh tokens.
drop table math_mate.learner_sessions;

alter table math_mate.student_responses rename column learner_id to user_id;
alter table math_mate.tutor_sessions rename column learner_id to user_id;
alter table math_mate.tutor_turns rename column learner_id to user_id;
alter table math_mate.learning_events rename column learner_id to user_id;
alter table math_mate.learner_outcome_state rename to user_outcome_state;
alter table math_mate.user_outcome_state rename column learner_id to user_id;
alter table math_mate.llm_calls rename column learner_id to user_id;

alter index math_mate.tutor_sessions_learner_part_idx rename to tutor_sessions_user_part_idx;
alter index math_mate.learning_events_learner_outcome_idx rename to learning_events_user_outcome_idx;
alter index math_mate.llm_calls_learner_created_idx rename to llm_calls_user_created_idx;

drop function math_mate.reserve_llm_call(text, text, text, text, uuid, uuid, numeric, numeric, numeric);

create function math_mate.reserve_llm_call(
    p_purpose text,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_user_id uuid,
    p_source_id uuid,
    p_estimate numeric,
    p_daily_budget numeric,
    p_user_daily_budget numeric
)
returns table (call_id uuid, blocked boolean)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
    spent numeric;
    user_spent numeric;
    is_blocked boolean;
begin
    perform pg_advisory_xact_lock(4024, 2);
    select coalesce(sum(c.cost_usd), 0),
           coalesce(sum(c.cost_usd) filter (where c.user_id = p_user_id), 0)
      into spent, user_spent
      from math_mate.llm_calls c
     where c.created_at >= date_trunc('day', now(), 'UTC');
    is_blocked := spent + p_estimate > p_daily_budget
        or (p_user_id is not null and user_spent + p_estimate > p_user_daily_budget);
    return query
        insert into math_mate.llm_calls
            (purpose, provider, model, prompt_version, status, user_id, source_id, cost_usd)
        values
            (p_purpose, p_provider, p_model, p_prompt_version,
             case when is_blocked then 'budget_blocked' else 'pending' end,
             p_user_id, p_source_id, case when is_blocked then 0 else p_estimate end)
        returning math_mate.llm_calls.id, is_blocked;
end;
$$;

revoke all on function math_mate.reserve_llm_call(text, text, text, text, uuid, uuid, numeric, numeric, numeric)
    from public, anon, authenticated;

comment on table math_mate.users is
    'Application user profile. Production rows use the verified auth.users UUID as both IDs.';
comment on column math_mate.users.auth_user_id is
    'Supabase Auth identity. It is nullable only so rollback-only tests can create isolated users without changing auth.users.';
comment on table math_mate.user_outcome_state is
    'Mastery projection rebuilt from learning_events, one row per user and outcome.';
