-- The FastAPI backend owns this schema. Do not expose it through Supabase Data API.
create schema if not exists math_mate;
revoke all on schema math_mate from public;

-- One row per source question. Nested parts, prompts, diagrams, and mark schemes
-- remain in the original question document rather than being split prematurely.
create table math_mate.questions (
    id text primary key,
    collection_id text not null,
    source_file text not null,
    topic_code text not null,
    subtopic_codes text[] not null default '{}',
    question_number integer not null check (question_number > 0),
    title text,
    total_marks integer not null check (total_marks >= 0),
    difficulty_rank smallint,
    paper_year smallint not null check (paper_year between 2000 and 2100),
    paper_session text not null,
    paper_component text not null,
    calculator_allowed boolean not null,
    question_data jsonb not null check (jsonb_typeof(question_data) = 'object'),
    collection_data jsonb not null check (jsonb_typeof(collection_data) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (collection_id, question_number)
);

comment on table math_mate.questions is
    'Curated Math Mate question bank; original question and collection JSON are stored alongside searchable metadata.';
comment on column math_mate.questions.question_data is
    'Original question object from data/*.json, including nested parts and mark schemes. Serve student-safe projections through the backend.';
comment on column math_mate.questions.collection_data is
    'Original collection object from the source JSON file. Repeated per question to keep this first version to one table.';

create index questions_topic_year_idx
    on math_mate.questions (topic_code, paper_year desc);
create index questions_subtopic_codes_idx
    on math_mate.questions using gin (subtopic_codes);
