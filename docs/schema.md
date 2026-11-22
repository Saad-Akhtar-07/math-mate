# Math Mate schema

The checked-in SQL files in `supabase/migrations/` are the schema source of truth. Math Mate uses one Supabase PostgreSQL database. The React app never receives PostgreSQL or Supabase secret credentials.

## Identity and ownership

Supabase Auth owns email addresses, password hashes, email verification, password recovery and login sessions. `math_mate.users` is the application profile table. A production row uses the verified `auth.users.id` UUID as both `users.id` and `users.auth_user_id`.

FastAPI verifies the Supabase access JWT and derives `user_id` from its `sub` claim. The browser never chooses an owner ID. Drafts, tutor sessions, learning events, mastery and AI usage all use `user_id`. Private tables remain in the server-only `math_mate` schema and are not exposed through the Supabase Data API.

The migration `20261118000000_supabase_auth_users.sql` intentionally removes all pre-launch guest activity, renames the ownership model from learners to users, and drops custom browser sessions. It does not delete `questions` or `question_parts`. Run `python -m backend.scripts.reset_user_data --apply` before applying that migration so private solution images are removed from Storage while their object keys still exist.

## Question bank

`math_mate.questions` holds one row per curated source question. Stable source IDs are preserved, and complete nested question and collection documents remain in JSONB. `math_mate.question_parts` projects stable answerable leaf IDs for foreign keys. Source JSON under `data/` remains authoritative and `backend/scripts/import_questions.py` performs repeatable upserts.

## Applying changes

Create a new numbered SQL migration for every schema change. Do not edit an applied migration or change the remote schema only through the dashboard.

```powershell
python -m backend.scripts.migrate
python -m backend.scripts.migrate --apply
python -m backend.scripts.import_questions --apply
```

Database integration tests use rollback-only transactions and the fake AI provider. Routine tests must never contact a paid model.
