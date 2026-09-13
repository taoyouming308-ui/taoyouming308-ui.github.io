-- Electronic monthly drafts reuse their immutable source-template object.
-- Their current values live in report_cells and append-only revisions, so a
-- second binary copy must not be a prerequisite for opening a new month.
set statement_timeout = '30s';
set lock_timeout = '5s';

alter table public.zysyr_report_uploads
  drop constraint if exists zysyr_report_uploads_object_path_key;

create unique index if not exists zysyr_report_uploads_owned_object_path_key
  on public.zysyr_report_uploads (object_path)
  where coalesce(display_data->>'source_object_reused', 'false') <> 'true';

alter table public.zysyr_report_uploads
  add constraint zysyr_report_uploads_shared_source_monthly_only check (
    coalesce(display_data->>'source_object_reused', 'false') <> 'true'
    or report_type = 'monthly_profit_loss'
  );

comment on index public.zysyr_report_uploads_owned_object_path_key is
  'Owned uploads remain one row per object; system monthly drafts may reference one retained immutable source template.';
