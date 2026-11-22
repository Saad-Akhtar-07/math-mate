-- Structured visual drafts and explicit attachment roles for graph/diagram marking.
-- The JSON stores student-created vector objects only; rendered pixels continue
-- to live in private Storage and are snapshotted with each submission.
alter table math_mate.student_responses
    add column visual_answer jsonb
    check (visual_answer is null or jsonb_typeof(visual_answer) = 'object');

alter table math_mate.response_submissions
    add column visual_answer jsonb
    check (visual_answer is null or jsonb_typeof(visual_answer) = 'object');

alter table math_mate.response_attachments
    add column role text not null default 'supporting_work'
    check (role in ('primary_visual', 'supporting_work'));

alter table math_mate.submission_attachments
    add column role text not null default 'supporting_work'
    check (role in ('primary_visual', 'supporting_work'));

-- Replacing a canvas preview first retires the old active row, so at most one
-- primary visual is ever visible in a mutable draft.
create unique index response_attachments_primary_visual_idx
    on math_mate.response_attachments(response_id)
    where removed_at is null and role = 'primary_visual';

-- Low-confidence visual results are not failed calls and must never become
-- learner evidence. They remain inspectable without pretending that zero was earned.
alter table math_mate.assessments drop constraint assessments_status_check;
alter table math_mate.assessments add constraint assessments_status_check
    check (status in ('pending', 'processing', 'completed', 'unreadable', 'needs_review', 'failed'));

comment on column math_mate.student_responses.visual_answer is
    'Mutable visual-answer-v1 vector objects; no image bytes or model output.';
comment on column math_mate.response_submissions.visual_answer is
    'Immutable visual-answer-v1 snapshot submitted for marking.';
comment on column math_mate.response_attachments.role is
    'One primary visual answer plus optional supporting working pages.';
