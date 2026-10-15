# Math Mate database schema

The SQL migration in [`supabase/migrations/20261015000000_question_bank.sql`](../supabase/migrations/20261015000000_question_bank.sql) is the schema source of truth. This document explains its use. Commit future schema changes as new migrations and update this document in the same change.

## Decision

Use **one `math_mate.questions` table for all curated questions**, regardless of topic or source paper. Each row has a stable ID and searchable metadata columns. `question_data jsonb` preserves the complete nested question, including parts, prompts, diagrams, responses, and mark schemes. `collection_data jsonb` preserves the source collection metadata. There is no table per topic or paper.

The current source bank is 32 files in `data/`, containing 181 questions. Those files remain the reviewed source material. `backend/import_questions.py` validates and upserts them by the question's existing `id`. Do not hand-edit a copy of a question in Supabase and leave its source JSON unchanged.

The `math_mate` schema is used server-side by `backend/app.py`. Do not expose it in Supabase's Data API or put database credentials in the React app. The full JSON includes mark schemes; the question-list API removes them and the mark-scheme endpoint serves them when requested.

## `math_mate.questions`

| Column | Type | Meaning / source |
| --- | --- | --- |
| `id` | `text` PK | Existing `questions[].id`; do not generate a new ID on import. |
| `collection_id` | `text` | `collection.id` from the source file. |
| `source_file` | `text` | Filename under `data/`, for traceability. |
| `topic_code` | `text` | Target bank topic from collection, question, or part alignment; the current bank is Topic `2`. |
| `subtopic_codes` | `text[]` | Distinct target subtopic codes from leaf parts, or from question alignment when no parts exist. A question may belong to multiple subtopics. |
| `question_number` | `integer` | `questions[].number` in the source paper. |
| `title` | `text` | `questions[].title`, when present. |
| `total_marks` | `integer` | `total_marks`, falling back to `marks`. |
| `difficulty_rank` | `smallint` | `difficulty.rank`, when present. |
| `paper_year` | `smallint` | `collection.source.year`. |
| `paper_session` | `text` | `collection.source.session`. |
| `paper_component` | `text` | `collection.source.component`; text preserves values such as `11` and `22`. |
| `calculator_allowed` | `boolean` | `collection.source.calculator_allowed`. |
| `question_data` | `jsonb` | Entire original `questions[]` object. |
| `collection_data` | `jsonb` | Entire original `collection` object. |
| `created_at`, `updated_at` | `timestamptz` | Import timestamps. An upsert should preserve `created_at` and refresh `updated_at`. |

`(collection_id, question_number)` is also unique, so one paper cannot accidentally import the same question number twice. The topic/year and subtopic indexes support the existing question-bank filters. The question JSON itself has no general index yet; add a targeted index only when a real query needs one.

Example filter:

```sql
select id, title, paper_year, paper_component, total_marks
from math_mate.questions
where topic_code = '2'
  and subtopic_codes @> array['2.2']::text[]
  and calculator_allowed = false
order by paper_year desc, question_number;
```

## Import and API rules

1. Read each `data/*.json` file and validate `collection.source` plus `questions` before writing.
2. Derive topic and subtopic codes using the fallback logic in `backend/import_questions.py`; some older papers use alignment on parts or question rather than `collection.syllabus.target_bank.topic_code`.
3. Upsert by `id`. Treat source JSON files as the reviewed content, and report duplicate IDs or conflicting `(collection_id, question_number)` values before import.
   Leaf part IDs must start with their question ID plus `-`; the solution endpoint uses this to fetch only the relevant question row.
4. Return question content through FastAPI. The list API strips mark schemes from every question part; `/api/v1/question-parts/{part_id}/solution` serves a selected answer and marking points.
5. Put learner sessions, saved work, uploads, and tutor messages in separate tables when those backend features are designed. They have a different lifecycle from curated questions.

The API field `localDraftOnly` means learner work remains in browser storage and tutor/uploads are unavailable. Question content itself comes from Supabase.

The migration was applied to Supabase and all 181 question rows were imported and verified on 15 October 2026. Re-run the importer after reviewing source JSON changes:

```powershell
.\.venv\Scripts\python.exe backend/import_questions.py
.\.venv\Scripts\python.exe backend/import_questions.py --apply
```

The first command validates without writing. The second upserts and verifies both full JSON objects for every imported question before committing. The importer does not delete rows whose source file was removed; review such deletions explicitly.
