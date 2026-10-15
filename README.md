# Math Mate

Math Mate is a React frontend and a FastAPI question-bank API for Cambridge O Level Mathematics 4024 practice. Curated questions live in Supabase PostgreSQL and are loaded through the backend.

## Run locally

Create `.env` from `.env.example` and fill in the server-side Supabase PostgreSQL connection details. Then, from the project root, install and start the backend:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

In another terminal, from `frontend/`:

```sh
npm install
npm run dev
```

On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

Vite proxies `/api` to `http://localhost:8000`. For a separately hosted frontend, set `VITE_API_URL` to the backend's public origin at build time and configure `MATH_MATE_CORS_ORIGINS` for that frontend origin. Never put the database password in a `VITE_` variable.

## Deploy

The browser calls FastAPI; FastAPI reads Supabase PostgreSQL. The included [`render.yaml`](render.yaml) configures a Render web service for `backend/`, and [`frontend/vercel.json`](frontend/vercel.json) keeps React Router links working on Vercel.

1. Put this project in a Git repository connected to Render and Vercel. The project root contains `render.yaml`; keep `.env` out of the repository.
2. In Render, create a **Blueprint** from that repository. Supply `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, and `SUPABASE_DB_PASSWORD` from Supabase **Connect → Session pooler**. The host is the pooler hostname and the user has the form `postgres.<project-ref>`. The Blueprint sets port `5432` and database `postgres`. Set `MATH_MATE_CORS_ORIGINS` to the exact Vercel frontend origin, for example `https://math-mate.vercel.app` (no trailing slash). If the final Vercel URL is not known yet, update this variable after deploying Vercel.
3. Check `https://<your-render-host>/api/v1/health` for `{"status":"ok"}`. Then check `/api/v1/questions/summary` for question counts. The Blueprint only starts the API; it does not create tables or import questions again.
4. In Vercel, import the same repository with **Root Directory** set to `frontend`. Set the production environment variable `VITE_API_URL=https://<your-render-host>` with no trailing slash. Deploy, then confirm that a topic loads questions and a deep link such as `/topic/2/practice` opens on refresh.
5. If the frontend is blocked by CORS, set `MATH_MATE_CORS_ORIGINS` in Render to the deployed Vercel origin and redeploy the backend. Add comma-separated origins if you also need preview domains.

Render's Free service sleeps after 15 minutes without traffic, and the first API request can take about a minute. The production question client allows 90 seconds for that wake-up. Use a paid Render instance if the site must respond promptly at all times. Supabase connection values belong only in Render's server-side environment variables; `VITE_API_URL` is a public backend URL, not a database credential.

## Check the Supabase database connection

This check connects directly to PostgreSQL and runs `SELECT 1`. It does not create tables or change data.

1. Copy `.env.example` to `.env` in the project root.
2. In your Supabase project, click **Connect → Session pooler**. Put its host and user in `.env`, then add your database password. Keep port `5432` and database `postgres` unless the connection details say otherwise. Use the values from **Connect**, since the pooler host cannot be determined from the region alone.
3. Install the small Python health-check dependencies and run the script from the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe backend/check_db.py
```

The script prints `Database healthy` when it can connect and query PostgreSQL. It exits with an error when configuration, authentication, network access, or the database query fails. `.env` is ignored by Git; do not put the password in the React frontend.

## Current scope

- Curated JSON files in `data/` are the reviewed source material. `backend/import_questions.py` validates and upserts them into Supabase; the frontend fetches its question counts, questions, and mark schemes through FastAPI.
- Questions can be browsed by subtopic and filtered by calculator or non-calculator paper. A question may appear in more than one subtopic if its parts assess multiple skills.
- The practice workspace renders equations, tables, graphs, diagrams and mark schemes from database-backed API responses. Text answers still save in this browser's local storage.
- Graph labels placed on a point or plotted line are moved to nearby clear space and drawn with a background outline. Labels already positioned away from a line keep their source coordinates.
- For a crowded graph that needs editorial placement, a graph label can specify an `offset` such as `[12, -16]` in SVG pixels. The renderer checks that offsets contain two finite numbers, and the question tests check that the result stays inside the SVG.
- Topics without imported questions show an empty state. The AI tutor and photo upload controls remain disabled until their separate backend services are implemented.

## Checks

From `frontend/`, run `npm run build`, `npm run test:questions`, `npm run test:voice` and `npm test`.

Run `npm run test:questions` after adding JSON papers. It checks that imported blocks render and graph labels stay inside the SVG viewport; the labelled distance–time graph is a regression case for text overlapping a line.
Keep `caption` and diagram label text student-facing. The question tests also reject internal source-paper wording and corrupted characters in rendered blocks. Use `display_view_box` on a `pattern_sequence` when its symbols need a tighter, shared view across panels.

The frontend needs the FastAPI server and Supabase connection to browse questions. Its `src/api/` modules also contain clients for future learner-session and voice services.

## Database design

The Supabase PostgreSQL schema is documented in [`docs/database-schema.md`](docs/database-schema.md), with executable SQL in [`supabase/migrations/`](supabase/migrations/). It keeps all curated questions in one table while preserving their nested JSON. The first migration has been applied and 181 questions have been imported.
