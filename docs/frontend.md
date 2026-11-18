# Student frontend

The student side was redesigned in October 2026. The agreed design (screens in light and dark, phone layouts and the theme sheet) is on the design canvas: https://claude.ai/artifact/Qigs3Cs7yX3Xw3VCEfNJZo. This page describes what was built, where it lives and the rules to keep. Sign-in and sign-up are not part of it yet; students use a guest workspace saved in their browser.

## Screens and routes

| Route | Screen | What it shows |
| --- | --- | --- |
| `/` | Home ([`HomePage.jsx`](../frontend/src/pages/HomePage.jsx)) | Continue card for the last unfinished question, three suggested questions with the reason for each, topic progress and the last 7 days. A new student sees "Good places to start" instead. |
| `/practice` | Redirect | Opens the first topic that has questions. |
| `/topic/:n` | Practice ([`PracticePage.jsx`](../frontend/src/pages/PracticePage.jsx)) | Topic buttons (topics without questions show as coming soon) and every subtopic with its question count, how many were tried, the average score and the focus area. |
| `/topic/:n/:code` | Questions in a subtopic ([`SubtopicPage.jsx`](../frontend/src/pages/SubtopicPage.jsx)) | Status per question, filters (status, paper, difficulty) kept in the URL, syllabus outcomes and "Start next question" / "Continue question". |
| `/topic/:n/practice` | Workspace ([`QuestionPracticePage.jsx`](../frontend/src/pages/QuestionPracticePage.jsx)) | One question with its parts, the working box, photos, Check my work and the tutor column. Follows `?subtopic=`, `?paper=` and `?difficulty=` so Previous/Next matches the list the student came from. |
| `/progress` | Progress ([`ProgressPage.jsx`](../frontend/src/pages/ProgressPage.jsx)) | Questions tried, average score, full marks without help, subtopics weakest first and recent attempts. |

The top bar ([`AppHeader.jsx`](../frontend/src/components/AppHeader.jsx)) has Home, Practice and Progress; below 720px the same links become a tab bar along the bottom. The workspace hides it and uses its own slim header.

## Workspace behaviour

- **One main action.** When AI is on, Check my work calls `POST /me/responses/{part}/assessments?wait=true`, which submits and marks in one step. Without AI, or for a graph or diagram answer (`aiMarkable: false`), the button is Submit answer. Questions served from bundled data (local-only mode) save on the device and have no button.
- **Marks by the working, words in the tutor.** The result strip shows marks, the attempt number and whether help was used; the feedback text appears in the tutor column. "Check again" stays disabled until the working changes. When marks are lost, "How it was marked" opens below the strip ([`MarkedWorking.jsx`](../frontend/src/components/workspace/MarkedWorking.jsx), matching in [`markedWorking.js`](../frontend/src/utils/markedWorking.js)): earned and lost mark codes, then the working as the Marker read it, with a cross on each line that lost marks and its mistake type. Other lines stay neutral because the Marker does not judge every line; with full marks every line is ticked. Older attempts without a `review` show the lines only, under "What I read".
- **Parts.** Only the open part is expanded; the others collapse to their status. Nested parts arrive flattened with the parent's text repeated (`(a)(i)`, `(a)(ii)`); [`groupParts`](../frontend/src/utils/workspace.js) shows the shared text once.
- **Photos.** On touch screens (`(pointer: coarse)`), Take photo opens the rear camera directly (`capture="environment"`, one page per shot) and Upload opens the gallery; desktops show one Add photo of working button. Both go through the same upload queue and four-page limit.
- **Resizable tutor.** On screens 1024px and wider, the tutor's left edge ([`TutorResizer.jsx`](../frontend/src/components/workspace/TutorResizer.jsx)) can be dragged or moved with the arrow keys, Home and End: at least 380px, at most 760px, and never so wide that the question column drops below 560px. Double-click resets it. The width is saved in the browser (`practice-tutor-width-v1`) and re-checked against the limits when the window changes size.
- **Tutor.** The quick buttons send the `hint`, `explain` and `show_step` intents. The help bar maps each teaching move to a level with `MOVE_ASSISTANCE` in [`utils/workspace.js`](../frontend/src/utils/workspace.js), which mirrors `ASSISTANCE` in `backend/app/tutoring/policy.py`: change both together.
- Saving, uploads, retries, conflicts and recovery copies are unchanged from before the redesign; see [database-schema.md](database-schema.md).

## Progress is worked out in the browser

There is no learner-profile endpoint yet (planned for M6). Home, Practice, the subtopic list and Progress combine the existing lists (`/topics/{n}/questions`, `/me/responses`, `/me/assessments`, `/me/tutor-turns`) with the functions in [`utils/progress.js`](../frontend/src/utils/progress.js):

- A question is **done** when every part has full marks, **try again** when a checked part is below full marks, **in progress** when any work exists, otherwise **new**.
- The **average score** counts the latest marked attempt of each part. The **focus area** is the lowest average below 70% with at least two checked parts.
- **Suggestions**: a question to try again, then the focus area, then a subtopic not yet tried, then the next new question elsewhere; graph-only questions are skipped. They are simple rules until server recommendations arrive.
- **Without help** follows the backend's rule: no completed tutor turn with assistance above zero on that part before the attempt was checked. If tutor history cannot load, Progress shows "–" rather than guessing.

[`useLearnerProgress`](../frontend/src/hooks/useLearnerProgress.js) only reads the signed-in user's saved responses and marking history.

## Theme

[`theme.css`](../frontend/src/theme.css) holds every colour as a role (`--bg`, `--surface`, `--ink`, `--brand`, `--good`, `--part`, `--bad` and their soft versions) for light and dark. Use these roles in new styles. Older variable names (`--accent`, `--text-primary` and so on) are aliases, kept for the question renderer and notes styles. Fonts: Bricolage Grotesque for headings, Atkinson Hyperlegible Next for text; maths is rendered by KaTeX.

The theme follows the device setting until the student presses the toggle; the choice is then saved (`syllabus-theme` in browser storage).

## Tests and checks

From `frontend/`: `npm test` (pure logic), `npm run test:questions` (screens and question rendering), `npm run test:voice` and `npm run build`. Every screen test mocks the API, so no test contacts a server or an AI provider.

To look at the real app without paid AI, start the API with `MATH_MATE_AI_PROVIDER=fake`, then run `npm run dev`. It uses the configured Supabase database and the fake provider marks and tutors with fixed replies.

## Known limits

- Suggestions, the focus area and "without help" are worked out in the browser and will move to the learner profile (M6).
- "Check again" uses the submitted flag and the latest attempt; a revision submitted while AI was off can leave it disabled until the work changes.
- The notes components in `components/notes/` are not linked from any screen.
