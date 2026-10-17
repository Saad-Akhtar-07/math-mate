-- Reverse file lookup is used by cleanup and foreign-key deletion checks,
-- including removed draft attachments that the active-only indexes omit.
create index response_attachments_file_lookup_idx
    on math_mate.response_attachments(file_id, response_id);
