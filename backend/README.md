# Math Mate backend

Run the commands below from the repository root. Server credentials stay in the root `.env`; configuration resolves that path independently of the working directory.

## Layout

```text
backend/
  app/
    main.py                  FastAPI assembly, middleware and connection-pool lifecycle
    api/
      dependencies.py        Guest authentication and private-response headers
      routes/                HTTP endpoints and request validation
    core/config.py           Environment configuration and project-root paths
    db/connection.py         PostgreSQL connections and API connection pool
    middleware/              Upload request-size limits
    repositories/            Shared queries for draft and submitted image metadata
    schemas/                 Validated request models
    services/                Questions, drafts, submissions, uploads, compression and Storage
  scripts/                   Administrative command-line tools
  tests/                     Unit tests and opt-in database integration tests
```

Routes delegate to services. Services own transaction boundaries so a draft update or submission snapshot commits as one operation. Shared image queries live in `repositories/`; private Storage access and compression stay in separate service modules. Administrative tools import these packages normally and run with `python -m`.

## Start the API

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Render uses `backend/` as its working directory and starts `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Existing environment settings and API URLs continue to apply.

## Administrative tools

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.check_db
.\.venv\Scripts\python.exe -m backend.scripts.import_questions
.\.venv\Scripts\python.exe -m backend.scripts.migrate
.\.venv\Scripts\python.exe -m backend.scripts.setup_storage
.\.venv\Scripts\python.exe -m backend.scripts.cleanup_storage
```

Import, migration and cleanup commands default to validation or a read-only plan. Add `--apply` to write reviewed changes. Storage setup checks the private bucket by default; `--apply` creates it if needed. SQL migrations remain in `supabase/migrations/`, and curated question JSON remains in `data/` at the repository root.

See [the database schema guide](../docs/database-schema.md) for schema decisions, migration steps, file lifecycle and private Storage setup.

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
