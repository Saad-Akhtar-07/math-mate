# Math Mate repository guide

- Read `docs/database-schema.md` before changing database or question-bank code. The SQL in `supabase/migrations/` is the database schema source of truth.
- Curated source questions are in `data/*.json`. `backend/scripts/import_questions.py` upserts them into Supabase; the running frontend fetches questions through `backend/app/main.py`. Keep imports repeatable and preserve existing question IDs.
- The `math_mate` database schema is for the backend. Never place the PostgreSQL password or connection details in `frontend/` or commit `.env`.
- Add schema changes as new SQL migrations and update the schema document. Do not change the remote schema only through the dashboard.
