-- Promote context-time BKT to the active learner model. The weighted projection
-- remains only as a rebuildable research baseline and is no longer read by the
-- tutoring runtime.

alter table math_mate.bkt_shadow_states rename to bkt_states;
alter table math_mate.bkt_shadow_updates rename to bkt_updates;
alter index math_mate.bkt_shadow_updates_user_outcome_idx rename to bkt_updates_user_outcome_idx;

comment on table math_mate.bkt_states is
    'Versioned per-user BKT skill states. bkt-context-time-v1 is the active learner model read by the tutor.';
comment on table math_mate.bkt_updates is
    'Auditable context, forgetting and mastery transitions for versioned BKT models; contains no student answer text.';
comment on table math_mate.user_outcome_state is
    'Legacy weighted mastery projection retained only as a rebuildable evaluation baseline; never read by the tutor.';
comment on table math_mate.learner_model_predictions is
    'Pre-observation weighted-baseline and BKT forecasts for offline evaluation; no student work or model prompts.';
