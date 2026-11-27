# Math Mate schema

The checked-in SQL files in `supabase/migrations/` are the schema source of truth. Math Mate uses one Supabase PostgreSQL database. The React app never receives PostgreSQL or Supabase secret credentials.

## Identity and ownership

Supabase Auth owns email addresses, password hashes, email verification, password recovery and login sessions. `math_mate.users` is the application profile table. A production row uses the verified `auth.users.id` UUID as both `users.id` and `users.auth_user_id`.

FastAPI verifies the Supabase access JWT and derives `user_id` from its `sub` claim. The browser never chooses an owner ID. Drafts, tutor sessions, learning events, mastery and AI usage all use `user_id`. Private tables remain in the server-only `math_mate` schema and are not exposed through the Supabase Data API.

The migration `20261118000000_supabase_auth_users.sql` intentionally removes all pre-launch guest activity, renames the ownership model from learners to users, and drops custom browser sessions. It does not delete `questions` or `question_parts`. Run `python -m backend.scripts.reset_user_data --apply` before applying that migration so private solution images are removed from Storage while their object keys still exist.

## Question bank

`math_mate.questions` holds one row per curated source question. Stable source IDs are preserved, and complete nested question and collection documents remain in JSONB. `math_mate.question_parts` projects stable answerable leaf IDs for foreign keys. Source JSON under `data/` remains authoritative and `backend/scripts/import_questions.py` performs repeatable upserts.

## Visual answers

`student_responses.visual_answer` stores the student's current structured graph or diagram overlay. It contains versioned vector objects, never image bytes. The matching rendered preview and any photographed working remain private `solution_files`; attachment roles distinguish the single primary visual answer from supporting pages. The primary attachment also records `visual_source`: an uploaded photo is authoritative in photo mode, while a fresh canvas rendering must match canvas mode.

Submitting freezes the text, visual JSON, question projection, attachment roles and visual source in `response_submissions` and `submission_attachments`. The Marker receives that immutable attempt. `unreadable`, `off_topic` and `needs_review` results have no marks and create no learning evidence.

## Learner memory and model evaluation

`learning_events` is the append-only evidence record. `bkt-context-time-v1` is the active learner model read by the tutoring policy. A new user has no `bkt_states` rows; the first reliable Marker attempt begins that outcome at the versioned `P(L0) = 0.5` prior, and each later marked attempt updates the user's own state online. Ordinary tutor chat never changes skill mastery.

`bkt_states` holds rebuildable projections keyed by user, outcome and model version. `bkt-shadow-v1` remains the standard research baseline: it accepts only independently completed, marked outcome observations. The active `bkt-context-time-v1` model updates from three contexts already established when an assessment is created: `independent`, `assisted`, and `after_solution`. A score of `1` is correct and any lower score is incorrect. Unmarked work does not enter either model.

The contextual model uses one pooled, explicitly unfitted parameter set for all skills. Independent and assisted attempts have separate guess, slip and learning probabilities. A shown solution deliberately skips the correct/incorrect Bayesian observation—the repeated answer is not proof of mastery—but applies its learning transition because an explanation can still teach. Before each interaction, the model applies a mastered-to-unmastered forgetting transition selected by elapsed time: 0–15, 16–30, 31–60, or over 60 days. These boundaries and probabilities belong to the model version; future tuning must create a new version rather than rewriting old results.

On its first new interaction for an outcome, the contextual model replays earlier append-only attempt events in chronological order. Historical evidence weight maps to the existing contexts: `1.0` independent, `0.5` assisted and `0.25` after solution. Replay initializes state only; it never manufactures retrospective forecasts. This avoids giving the weighted evaluation baseline a historical advantage while still ensuring that every scored forecast was genuinely made before its result was known.

`bkt_updates` is the audit trail for contextual transitions. It records the context, observed result, whether that result was used as mastery evidence, elapsed days, forgetting bucket and probability, and mastery before and after each stage. It contains no student answer text. When the tutor reads a profile, elapsed-time forgetting is projected from the stored state without writing a new event. Confidence is based on diagnostic Marker observations and prevents one attempt from changing the starting help level.

`user_outcome_state` is the old weighted projection. It is still rebuilt after Marker attempts solely so the existing experiments remain reproducible; no runtime tutoring component reads it. `learner_model_predictions` holds forecasts for independent marked attempts, recording the weighted baseline and each BKT version before the result. Rows with `bkt_evidence_count_before = 0` measure cold start; larger counts measure personalized follow-up behaviour. Brier score and log loss compare versions offline.

`python -m backend.scripts.rebuild_context_bkt_states --apply` rebuilds active contextual states for existing accounts from `learning_events`. It does not create rows for users without attempts and does not manufacture past predictions or update-audit rows.

## Applying changes

Create a new numbered SQL migration for every schema change. Do not edit an applied migration or change the remote schema only through the dashboard.

```powershell
python -m backend.scripts.migrate
python -m backend.scripts.migrate --apply
python -m backend.scripts.import_questions --apply
```

Database integration tests use rollback-only transactions and the fake AI provider. Routine tests must never contact a paid model.
