# Math Mate repository guide

- Read `docs/database-schema.md` before changing database or question-bank code. The SQL in `supabase/migrations/` is the database schema source of truth.
- Curated source questions are in `data/*.json`. `backend/scripts/import_questions.py` upserts them into Supabase; the running frontend fetches questions through `backend/app/main.py`. Keep imports repeatable and preserve existing question IDs.
- The `math_mate` database schema is for the backend. Never place the PostgreSQL password or connection details in `frontend/` or commit `.env`.
- Add schema changes as new SQL migrations and update the schema document. Do not change the remote schema only through the dashboard.

## Paid AI testing budget

The owner has a very small API budget. These rules apply to DeepSeek and any other paid AI provider, including calls triggered through the app UI, scripts, SDKs or background jobs.

- Use mocks, local fixtures and recorded synthetic responses for routine development, regression tests, CI, watch mode and browser checks. Test success, failures, timeouts, malformed responses and retries without contacting a paid provider. A configured API key must not cause tests to make real requests.
- Do not make a paid AI request without explicit user authorization for that specific, bounded test batch. Permission to implement a feature, run tests or debug the app, and the presence of an API key, are not authorization to spend API credit. Reuse authorization within its agreed limits; ask again only if more calls or a larger budget are needed.
- Before a live test, state the model, maximum request count, output/reasoning limits and estimated maximum cost using verified provider pricing. If the cost cannot be bounded, use mocks until the limits are clear. Default to one request unless the user explicitly authorizes more.
- Use the configured inexpensive model (`DEEPSEEK_MODEL`, currently `deepseek-flash`). Do not silently switch to a more expensive model. Use a short prompt and the minimum representative input; send one solution photo when that is sufficient, rather than a full set of pages or conversation history.
- For an approved smoke test, default to at most 512 generated tokens, counting reasoning where the provider supports a combined cap. Disable thinking for a simple connectivity or response-format check when supported. A larger limit or reasoning test must fit the explicitly agreed batch budget; a visible-answer limit alone must not be treated as a reasoning-cost cap.
- Disable SDK automatic retries for live tests (`max_retries=0` or the provider equivalent). Do not retry errors, poll a model, regenerate outputs, run parallel paid calls, or repeat a successful smoke test without accounting for every additional request in the authorized batch.
- When adding paid integration tests, make them opt-in and excluded from normal test commands. An opt-in flag is an additional guard, not a substitute for user authorization. Verify most behavior with a mocked provider, including retry and duplicate-submission protection.
- During testing, prevent incidental model calls from startup, health checks, page navigation, previews, uploads and autosaves. Mock the AI boundary while exercising student flows. Do not run paid load tests or leave an AI-calling job running unattended.
- Record only safe usage metadata for an approved live test: model, request count, billed input/output/reasoning tokens where available, and estimated or reported cost. Stop when the authorized limit is reached or usage is unclear. Never print API keys, student solution content or private signed image URLs in test reports.
- Report which checks used mocks and exactly how many live requests were made. Do not claim a live integration was verified when only mocks were used. Budget checks and spend controls are required parts of future AI integration work.
