-- Reserve a paid model call in one database round trip.
-- The backend previously sent the lock, the spend query and the insert as
-- separate statements, and each one is a network round trip. Inside a function
-- every statement takes a fresh snapshot after the lock is held, so
-- concurrent reservations still cannot overspend the daily budget together.

create or replace function math_mate.reserve_llm_call(
    p_purpose text,
    p_provider text,
    p_model text,
    p_prompt_version text,
    p_learner_id uuid,
    p_source_id uuid,
    p_estimate numeric,
    p_daily_budget numeric,
    p_learner_daily_budget numeric
)
returns table (call_id uuid, blocked boolean)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
    spent numeric;
    learner_spent numeric;
    is_blocked boolean;
begin
    perform pg_advisory_xact_lock(4024, 2);
    select coalesce(sum(c.cost_usd), 0),
           coalesce(sum(c.cost_usd) filter (where c.learner_id = p_learner_id), 0)
      into spent, learner_spent
      from math_mate.llm_calls c
     where c.created_at >= date_trunc('day', now(), 'UTC');
    is_blocked := spent + p_estimate > p_daily_budget
        or (p_learner_id is not null and learner_spent + p_estimate > p_learner_daily_budget);
    return query
        insert into math_mate.llm_calls (purpose, provider, model, prompt_version, status, learner_id, source_id, cost_usd)
        values (p_purpose, p_provider, p_model, p_prompt_version,
                case when is_blocked then 'budget_blocked' else 'pending' end,
                p_learner_id, p_source_id, case when is_blocked then 0 else p_estimate end)
        returning math_mate.llm_calls.id, is_blocked;
end;
$$;

-- Functions are executable by PUBLIC by default; only the backend role may reserve calls.
revoke all on function math_mate.reserve_llm_call(text, text, text, text, uuid, uuid, numeric, numeric, numeric)
    from public, anon, authenticated;

comment on function math_mate.reserve_llm_call(text, text, text, text, uuid, uuid, numeric, numeric, numeric) is
    'Locks the budget, sums today''s spend and inserts a pending or budget_blocked llm_calls row in one call.';
