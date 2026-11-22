# Math Mate backend

Run the commands below from the repository root. Server credentials stay in the root `.env`; configuration resolves that path independently of the working directory.

## Layout

```text
backend/
  app/
    main.py                  FastAPI assembly, middleware and connection-pool lifecycle
    api/
      router.py              One place that assembles all HTTP route modules
      dependencies.py        Supabase JWT authentication and private-response headers
      routes/                HTTP endpoints and request validation
    core/config.py           Environment configuration and project-root paths
    db/connection.py         PostgreSQL connections and API connection pool
    middleware/              Upload request-size limits
    repositories/            Shared queries for draft and submitted image metadata
    schemas/                 Validated request models
    services/                Questions, drafts, submissions, uploads, Storage, marking jobs,
                             tutor turns and learner memory (transactions and ownership)
    tutoring/                Pure marking and tutoring logic: part context, mark-scheme rules,
                             Marker, Observer, policy, Composer, leak guard, learner model,
                             catalogue/ (all 150 outcomes, skill aliases, and misconceptions for Topics 1-9)
    ai/                      The only code that calls a model: gateway (budget ledger, no
                             retries), DeepSeek and fake providers, prices, versioned prompts
  scripts/                   Administrative command-line tools
  tests/                     Unit tests, opt-in database tests and opt-in live AI gates (tests/live)
```

Routes delegate to services. Services own transaction boundaries so a draft update or submission snapshot commits as one operation. Shared image queries live in `repositories/`; private Storage access and compression stay in separate service modules. Administrative tools import these packages normally and run with `python -m`.

Each layer imports only the layers below it: routes → services → tutoring → ai. `tutoring/` never opens a database connection, and services never hold a connection during a model call.

## AI marking and tutoring

`MATH_MATE_AI_PROVIDER` defaults to `off`. Set it to `fake` for free local development: marking, streamed tutor replies and learner memory all work with deterministic responses. Set `deepseek` only when paid calls are intended, and keep the daily caps in `.env` small. Read the paid-AI budget rules in `AGENTS.md` before any live request.

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.evaluate_marker          # replay recorded outputs (free)
.\.venv\Scripts\python.exe -m backend.scripts.evaluate_marker --fake   # check the pipeline (free)
```

Live gates G1–G3 in `tests/live/` each make one bounded request. They skip unless `MATH_MATE_LIVE_AI_TEST=1` and `MATH_MATE_AI_PROVIDER=deepseek` are set, and they must only be run after the owner approves that batch.

## Start the API

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Render uses `backend/` as its working directory and starts `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Existing environment settings and API URLs continue to apply.

## Administrative tools

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.check_db
.\.venv\Scripts\python.exe -m backend.scripts.check_auth_config
.\.venv\Scripts\python.exe -m backend.scripts.check_auth_schema
.\.venv\Scripts\python.exe -m backend.scripts.import_questions
.\.venv\Scripts\python.exe -m backend.scripts.migrate
.\.venv\Scripts\python.exe -m backend.scripts.reset_user_data
.\.venv\Scripts\python.exe -m backend.scripts.setup_storage
.\.venv\Scripts\python.exe -m backend.scripts.cleanup_storage
.\.venv\Scripts\python.exe -m backend.scripts.sync_outcomes
```

`tests/test_question_files.py` is the acceptance gate for every JSON question file below `data/`. It checks file names, topic placement, IDs, outcome codes, controlled skills, marks, mark-scheme entries, prompt blocks and response types, and names the exact part and rule when something is wrong. Run it after adding an extracted paper.

`sync_outcomes` regenerates `app/tutoring/catalogue/outcomes.json` from the official outcomes in `frontend/src/data/syllabus.js`, keeping skill aliases. Run it with `--apply` after changing syllabus outcomes.

Supabase PostgreSQL is the only database. The API, tests, migrations and imports all use the `SUPABASE_DB_*` settings.

Import, migration and cleanup commands default to validation or a read-only plan. Add `--apply` to write reviewed changes. Storage setup checks the private bucket by default; `--apply` creates it if needed. SQL migrations remain in `supabase/migrations/`, and curated question JSON remains in `data/` at the repository root.

See [the database schema guide](../docs/schema.md) for schema decisions, authentication ownership and migration steps.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest backend/tests
```

Image and Storage unit tests run locally. Database integration tests skip unless `MATH_MATE_TEST_DB=1`; they use the configured database with rollback-only transactions and a fake object store. Use a development database for these checks.

```powershell
$env:MATH_MATE_TEST_DB = '1'
.\.venv\Scripts\python.exe -m pytest backend/tests
```
