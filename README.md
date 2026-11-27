# Math Mate

Math Mate is a React frontend and a FastAPI question-bank API for Cambridge O Level Mathematics 4024 practice.

## Project map

```text
frontend/               React pages, components, API clients and browser auth
backend/app/
  api/                  HTTP dependencies, route modules and their central router
  services/             Database transactions and application workflows
  tutoring/             Pure marking, tutoring policy and learner-model logic
  ai/                   Model gateway, providers, prices and versioned prompts
data/                   Curated source questions imported into Supabase
supabase/migrations/    PostgreSQL schema source of truth
docs/                   Frontend, backend and schema guides
extraction-prompts/     Preserved question-extraction prompt tooling; not runtime code
```

The browser talks to FastAPI, and FastAPI is the only application layer that talks to Supabase PostgreSQL. See [the frontend guide](docs/frontend.md), [backend guide](backend/README.md), and [schema guide](docs/schema.md) before extending those areas. The active context-time BKT learner model, retained baselines and evaluation rules are documented in [the BKT model guide](docs/bkt-model.md).

## Run locally

Create `.env` from `.env.example` and fill in the server-side Supabase PostgreSQL connection details. Set `SUPABASE_URL` for JWT verification. For solution photos, also set `SUPABASE_SECRET_KEY` (or the legacy ``SUPABASE_SERVICE_ROLE_KEY`). These secrets stay on the backend. Then, from the project root, install and start the backend:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m backend.scripts.migrate --apply
.\.venv\Scripts\python.exe -m backend.scripts.setup_storage --apply
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In another terminal, from `frontend/`:

```sh
npm install
npm run dev
```

Create `frontend/.env` from `frontend/.env.example` and set the public Supabase project URL and publishable key. In Supabase Authentication, enable email/password sign-in and **Confirm email**, then add `http://localhost:5173/auth/callback` to the allowed redirect URLs.

On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

Vite proxies `/api` to `http://localhost:8000`. For a separately hosted frontend, set `VITE_API_URL` to the backend's public origin at build time and configure `MATH_MATE_CORS_ORIGINS` for that frontend origin. Never put the database password in a `VITE_` variable.

## Deploy

The browser calls FastAPI; FastAPI reads Supabase PostgreSQL. The included [`render.yaml`](render.yaml) configures a Render web service for `backend/`, and [`frontend/vercel.json`](frontend/vercel.json) keeps React Router links working on Vercel.

The topic folders below the root `data/` directory and unused frontend JSON notes/questions are ignored by Git because the deployed app reads questions from Supabase. Keep `frontend/src/data/syllabus.js` and `frontend/src/data/localDrafts.js` in Git: the React build imports those modules. A broad ignore rule such as `data` also hides `frontend/src/data/` and breaks the Vercel build.

1. Put this project in a Git repository connected to Render and Vercel. The project root contains `render.yaml`; keep `.env` out of the repository.
2. In Render, create a **Blueprint** from that repository. Supply `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, and `SUPABASE_DB_PASSWORD` from Supabase **Connect → Session pooler**. The host is the pooler hostname and the user has the form `postgres.<project-ref>`. The Blueprint sets port `5432` and database `postgres`. Set `MATH_MATE_CORS_ORIGINS` to the exact Vercel frontend origin, for example `https://math-mate.vercel.app` (no trailing slash). If the final Vercel URL is not known yet, update this variable after deploying Vercel.
3. Check `https://<your-render-host>/api/v1/health` for `{"status":"ok"}`. Then check `/api/v1/questions/summary` for question counts. The Blueprint only starts the API; it does not create tables or import questions again.
4. In Vercel, import the same repository with **Root Directory** set to `frontend`. Set `VITE_API_URL=https://<your-render-host>`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. In Supabase Auth URL settings, set the Vercel origin as the Site URL and add `https://<your-vercel-host>/auth/callback` and `/reset-password` redirect URLs. Deploy, sign up with a real email, verify it, and confirm that sign-in restores the same progress.
5. If the frontend is blocked by CORS, set `MATH_MATE_CORS_ORIGINS` in Render to the deployed Vercel origin and redeploy the backend. Add comma-separated origins if you also need preview domains.

Render's Free service sleeps after 15 minutes without traffic, and the first API request can take about a minute. The production question client allows 90 seconds for that wake-up. On page entry, the frontend starts fetching the question summary and the Topic 1 and Topic 2 banks; later navigation reuses those in-memory requests. Subtopic and practice pages hold their question area with loading placeholders. Direct links can still wait for a cold backend. Use a paid Render instance if the site must respond promptly at all times. Supabase connection values belong only in Render's server-side environment variables; `VITE_API_URL` is a public backend URL, not a database credential.

## Check the Supabase database connection

This check connects directly to PostgreSQL and runs `SELECT 1`. It does not create tables or change data.

1. Copy `.env.example` to `.env` in the project root.
2. In your Supabase project, click **Connect → Session pooler**. Put its host and user in `.env`, then add your database password. Keep port `5432` and database `postgres` unless the connection details say otherwise. Use the values from **Connect**, since the pooler host cannot be determined from the region alone.
3. Install the small Python health-check dependencies and run the script from the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m backend.scripts.check_db
```

The script prints `Database healthy` when it can connect and query PostgreSQL. It exits with an error when configuration, authentication, network access, or the database query fails. `.env` is ignored by Git; do not put the password in the React frontend.

## Current scope

- Curated JSON files in `data/` are the reviewed source material. `backend/scripts/import_questions.py` validates and upserts them into Supabase; the frontend fetches its question counts, questions, and mark schemes through FastAPI.
- Students start on Home (continue where they stopped, three suggested questions with reasons, the last 7 days), browse Practice by topic and subtopic, and filter a subtopic's questions by status, paper and difficulty. Progress shows questions tried, average score, full marks without help, weakest subtopics and recent attempts. A question may appear in more than one subtopic if its parts assess multiple skills. See [docs/frontend.md](docs/frontend.md).
- The practice workspace renders equations, tables, graphs, diagrams and mark schemes from database-backed API responses. Signed-in users' text answers auto-save to Supabase after a pause. Students can submit each part and view earlier submitted answers; later edits preserve those attempts. Browser storage keeps only a recovery copy until the server confirms the save.
- Supabase Auth provides sign-up, verified email, sign-in, password recovery, token refresh and sign-out. FastAPI verifies the Supabase JWT and uses its user UUID for every private query.
- Graph labels placed on a point or plotted line are moved to nearby clear space and drawn with a background outline. Labels already positioned away from a line keep their source coordinates.
- For a crowded graph that needs editorial placement, a graph label can specify an `offset` such as `[12, -16]` in SVG pixels. The renderer checks that offsets contain two finite numbers, and the question tests check that the result stays inside the SVG.
- Students can attach up to four JPEG, PNG or WebP solution pages per answer (10 MB per original). The backend compresses each page separately into a private Supabase Storage object. Image-only answers can be submitted, and submitted pages remain viewable after removing them from a later draft. Upload controls enable when server Storage settings are present.
- "Check my work" submits the saved answer and marks typed work and photos together against the mark scheme. Code validates and totals the marks, and the result shows what was read. The tutor column then streams guidance for each mistake (hint, explanation, next step), escalating help only when needed and never revealing the answer early. A fixed answer is proven by resubmitting. Learning evidence is stored per official learning outcome. AI is off unless `MATH_MATE_AI_PROVIDER` is set; use `fake` for free local development. Graph and diagram answers are not AI-marked yet.
- Photo uploads show individual progress and wait for save confirmation. Failed and waiting photos can be retried without reselecting them while the practice page stays open; saved pages are preserved. Retry checks and server deduplication prevent duplicate pages after a lost confirmation. Resolve or remove unfinished photos before submitting.

## Checks

From `frontend/`, run `npm run test:all` and `npm run build`.

Run `npm run test:questions` after adding JSON papers. It checks that imported blocks render and graph labels stay inside the SVG viewport; the labelled distance–time graph is a regression case for text overlapping a line.
Keep `caption` and diagram label text student-facing. The question tests also reject internal source-paper wording and corrupted characters in rendered blocks. Use `display_view_box` on a `pattern_sequence` when its symbols need a tighter, shared view across panels.

The frontend needs the FastAPI server and a verified Supabase account. The AI marking and tutor clients use the Supabase access token; the voice client is kept for a later voice service and remains disabled.

## Database design

The Supabase PostgreSQL schema is documented in [`docs/schema.md`](docs/schema.md). Executable SQL lives in [`supabase/migrations/`](supabase/migrations/). Curated questions retain their nested JSON; relational part identities connect them to users, editable drafts and submitted snapshots.

Run `python -m backend.scripts.migrate` for a read-only migration plan or add `--apply` to apply pending changes transactionally. For the one-time guest reset, first run `python -m backend.scripts.reset_user_data --apply`, then apply the auth migration. Questions are preserved. The Render start command does not migrate.

Unused upload files can be reviewed with `python -m backend.scripts.cleanup_storage` and removed with `--apply` after a 24-hour grace period. Active draft pages and submitted pages are retained. See the schema document for image validation, storage credentials, cleanup behavior and deployment settings.

The [backend development guide](backend/README.md) explains the package layout, service boundaries and administrative commands.
