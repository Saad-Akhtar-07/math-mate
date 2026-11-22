-- Record what the primary visual image represents. This prevents an older
-- canvas preview from being mistaken for a newly selected photo (and vice versa).
alter table math_mate.response_attachments
    add column visual_source text
    check (visual_source is null or visual_source in ('canvas', 'photo'));

alter table math_mate.submission_attachments
    add column visual_source text
    check (visual_source is null or visual_source in ('canvas', 'photo'));

-- Existing primary images were created from the draft's selected source.
update math_mate.response_attachments a
set visual_source = r.visual_answer ->> 'primary_source'
from math_mate.student_responses r
where a.response_id = r.id and a.role = 'primary_visual';

update math_mate.submission_attachments a
set visual_source = s.visual_answer ->> 'primary_source'
from math_mate.response_submissions s
where a.submission_id = s.id and a.role = 'primary_visual';

alter table math_mate.response_attachments
    add constraint response_attachments_visual_role_source_check
    check ((role = 'primary_visual') = (visual_source is not null));

alter table math_mate.submission_attachments
    add constraint submission_attachments_visual_role_source_check
    check ((role = 'primary_visual') = (visual_source is not null));

comment on column math_mate.response_attachments.visual_source is
    'Whether the primary image represents the canvas overlay or a user-uploaded photo; null for supporting work.';
comment on column math_mate.submission_attachments.visual_source is
    'Immutable source of the submitted primary visual image.';
