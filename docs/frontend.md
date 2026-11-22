# Student frontend guide

The frontend is a Vite + React application. It authenticates students with Supabase Auth and calls FastAPI for question content, saved work, uploads, marking and tutoring. It never connects directly to PostgreSQL and never receives backend secrets.

## Runtime flow

1. `main.jsx` creates the React app, installs the auth provider and starts background question preloading.
2. `App.jsx` owns route protection and lazy-loads student pages.
3. Modules in `src/api/` make HTTP requests. Authenticated requests use the current Supabase access token.
4. Hooks in `src/hooks/` turn API data and browser capabilities into state used by pages.
5. Pages compose reusable components; they do not query Supabase PostgreSQL directly.

`localStorage` is only a recovery copy for unsaved answer text and small UI preferences. Confirmed answers, submissions, images, tutor turns and progress live in Supabase through the backend.

## Source layout

```text
frontend/src/
  api/                    Backend clients and transport helpers
  auth/                   Supabase browser client and session context
  components/
    question-renderer/    Structured maths, graph and diagram rendering
    workspace/            Practice workspace building blocks
    notes/                Shared tutor rich-text and maths rendering
  data/                   Syllabus metadata and local draft recovery
  hooks/                  Reusable state and browser behavior
  pages/                  Route-level screens and their page styles
    auth/                 Sign-in, sign-up and account recovery screens
  utils/                  Pure formatting, progress and workspace rules
```

`src/data/questionBanks.js` is a test-only adapter over curated JSON in the root `data/` directory. The running app gets questions from FastAPI; this adapter exists so rendering and question-import assumptions can be checked without a database.

## Routes

| Route | Page | Purpose |
| --- | --- | --- |
| `/sign-in`, `/sign-up` | Auth pages | Account access and email verification |
| `/forgot-password`, `/reset-password` | Auth pages | Password recovery |
| `/` | Home | Continue work, suggestions and recent activity |
| `/practice` | Redirect | Opens the first topic containing questions |
| `/topic/:topicNumber` | Practice | Topic overview and subtopic progress |
| `/topic/:topicNumber/:subtopicNumber` | Subtopic | Filtered question list |
| `/topic/:topicNumber/practice` | Question practice | Answers, uploads, marking and tutor workspace |
| `/progress` | Progress | Results, weak areas and recent attempts |

All student routes require a valid Supabase session. Vercel rewrites direct browser requests to `index.html`, and React Router chooses the screen.

## Where changes belong

- Add or change an endpoint call in `src/api/`, then expose reusable state through a hook when more than one screen needs it.
- Keep route pages focused on screen state and composition. Move repeated UI into `components/` and pure calculations into `utils/`.
- Keep structured question visuals in `components/question-renderer/`; there is only one renderer implementation.
- Put global tokens and resets in `theme.css` and `index.css`. Keep screen-specific rules beside the page and workspace-specific rules in the existing workspace styles.
- Never add database passwords, Supabase secret keys or paid-AI keys to `frontend/.env` or any `VITE_` variable.

## Checks

From `frontend/` run:

```powershell
npm test
npm run test:voice
npm run test:questions
npm run build
```

These checks use local data and mocks. They do not call a paid AI provider.
