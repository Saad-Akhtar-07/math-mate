-- File bytes live in private Supabase Storage, never in PostgreSQL.
-- Pending rows are durable upload intents, allowing failed uploads to be retried
-- and abandoned objects to be cleaned without guessing which keys are live.
create table math_mate.solution_files (
    id uuid primary key default gen_random_uuid(),
    response_id uuid not null references math_mate.student_responses(id) on delete cascade,
    bucket text not null,
    object_key text not null unique,
    upload_sha256 text not null check (length(upload_sha256) = 64),
    sha256 text not null check (length(sha256) = 64),
    original_bytes integer not null check (original_bytes between 1 and 10485760),
    stored_bytes integer not null check (stored_bytes between 1 and 5242880),
    width integer not null check (width between 1 and 2200),
    height integer not null check (height between 1 and 2200),
    media_type text not null default 'image/jpeg' check (media_type = 'image/jpeg'),
    encoding_version text not null default 'jpeg-v1',
    state text not null default 'pending' check (state in ('pending', 'ready', 'deleting')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (response_id, upload_sha256),
    unique (id, response_id)
);
create index solution_files_cleanup_idx on math_mate.solution_files(updated_at);

create table math_mate.response_attachments (
    id uuid primary key default gen_random_uuid(),
    response_id uuid not null references math_mate.student_responses(id) on delete cascade,
    file_id uuid not null,
    position smallint not null check (position between 1 and 4),
    original_filename text not null check (char_length(original_filename) between 1 and 255),
    created_at timestamptz not null default now(),
    removed_at timestamptz,
    foreign key (file_id, response_id) references math_mate.solution_files(id, response_id) on delete cascade
);
-- These indexes enforce four active pages even across simultaneous uploads.
create unique index response_attachments_slot_idx
    on math_mate.response_attachments(response_id, position) where removed_at is null;
create unique index response_attachments_file_idx
    on math_mate.response_attachments(response_id, file_id) where removed_at is null;

alter table math_mate.response_submissions add unique (id, response_id);
alter table math_mate.response_submissions drop constraint response_submissions_typed_work_check;
alter table math_mate.response_submissions add constraint submission_text_length
    check (char_length(typed_work) <= 20000);

create table math_mate.submission_attachments (
    submission_id uuid not null,
    response_id uuid not null,
    file_id uuid not null,
    position smallint not null check (position between 1 and 4),
    original_filename text not null,
    primary key (submission_id, position),
    unique (submission_id, file_id),
    foreign key (submission_id, response_id) references math_mate.response_submissions(id, response_id) on delete cascade,
    foreign key (file_id, response_id) references math_mate.solution_files(id, response_id)
        on delete no action deferrable initially deferred
);
create index submission_attachments_file_idx on math_mate.submission_attachments(file_id);

-- A submitted answer may be text, images, or both. Validate after image snapshot
-- links are inserted in the same transaction, including for image-only answers.
create function math_mate.check_submission_content() returns trigger
language plpgsql set search_path = pg_catalog, math_mate as $$
declare target_id uuid;
begin
    if tg_table_name = 'response_submissions' then target_id := new.id;
    else target_id := old.submission_id; end if;
    if exists (select 1 from math_mate.response_submissions s
        where s.id = target_id and length(btrim(s.typed_work)) = 0
        and not exists (select 1 from math_mate.submission_attachments a where a.submission_id = s.id)) then
        raise exception 'A submission must contain text or an image' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger submission_has_content after insert or update on math_mate.response_submissions
    deferrable initially deferred for each row execute function math_mate.check_submission_content();
create constraint trigger submission_keeps_content after delete on math_mate.submission_attachments
    deferrable initially deferred for each row execute function math_mate.check_submission_content();

alter table math_mate.solution_files enable row level security;
alter table math_mate.response_attachments enable row level security;
alter table math_mate.submission_attachments enable row level security;
revoke all on math_mate.solution_files, math_mate.response_attachments, math_mate.submission_attachments from public, anon, authenticated;
revoke all on function math_mate.check_submission_content() from public;

comment on table math_mate.solution_files is 'Separate compressed page objects; upload intents and metadata only. No raw originals, merged images, or AI data.';
comment on table math_mate.submission_attachments is 'Ordered immutable file references for each submitted attempt; draft removal does not delete submitted pages.';
