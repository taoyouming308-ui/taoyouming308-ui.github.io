create table if not exists public.zysyr_report_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  report_type text not null
    check (report_type in ('daily', 'performance', 'monthly_profit_loss')),
  report_date date not null,
  template_code text not null,
  template_version integer not null default 1 check (template_version > 0),
  version integer not null default 1 check (version > 0),
  supersedes_report_id uuid,
  status text not null default 'active' check (status in ('active', 'superseded')),
  original_filename text not null,
  mime_type text not null check (
    mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bucket_id text not null default 'zysyr-reports' check (bucket_id = 'zysyr-reports'),
  object_path text not null unique,
  display_data jsonb not null default '{}'::jsonb check (jsonb_typeof(display_data) = 'object'),
  uploaded_by_user_id uuid not null,
  uploaded_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, report_type, report_date, version),
  foreign key (company_id, store_id)
    references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, supersedes_report_id)
    references public.zysyr_report_uploads(company_id, id) on delete restrict,
  foreign key (company_id, uploaded_by_user_id)
    references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (report_type <> 'monthly_profit_loss' or report_date = date_trunc('month', report_date)::date),
  check (supersedes_report_id is null or version > 1)
);

create index if not exists zysyr_report_uploads_scope_latest_idx
  on public.zysyr_report_uploads
  (company_id, store_id, report_type, report_date desc, version desc);

create index if not exists zysyr_report_uploads_uploader_idx
  on public.zysyr_report_uploads (company_id, uploaded_by_user_id, uploaded_at desc);

create index if not exists zysyr_report_uploads_supersedes_idx
  on public.zysyr_report_uploads (company_id, supersedes_report_id)
  where supersedes_report_id is not null;

create index if not exists zysyr_report_uploads_sha_idx
  on public.zysyr_report_uploads (company_id, sha256);

create or replace function zysyr_private.protect_finance_report_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.company_id is distinct from new.company_id
    or old.store_id is distinct from new.store_id
    or old.report_type is distinct from new.report_type
    or old.report_date is distinct from new.report_date
    or old.template_code is distinct from new.template_code
    or old.template_version is distinct from new.template_version
    or old.version is distinct from new.version
    or old.supersedes_report_id is distinct from new.supersedes_report_id
    or old.original_filename is distinct from new.original_filename
    or old.mime_type is distinct from new.mime_type
    or old.size_bytes is distinct from new.size_bytes
    or old.sha256 is distinct from new.sha256
    or old.bucket_id is distinct from new.bucket_id
    or old.object_path is distinct from new.object_path
    or old.display_data is distinct from new.display_data
    or old.uploaded_by_user_id is distinct from new.uploaded_by_user_id
    or old.uploaded_at is distinct from new.uploaded_at
  then
    raise exception 'finance report versions are immutable';
  end if;
  if old.status = 'superseded' or new.status <> 'superseded' then
    raise exception 'only active report versions can be marked superseded';
  end if;
  return new;
end;
$$;

revoke execute on function zysyr_private.protect_finance_report_version() from public, anon, authenticated, service_role;

drop trigger if exists zysyr_report_uploads_protect_version on public.zysyr_report_uploads;
create trigger zysyr_report_uploads_protect_version
before update on public.zysyr_report_uploads
for each row execute function zysyr_private.protect_finance_report_version();

create or replace function zysyr_private.audit_finance_report_upload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.zysyr_audit_events (
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, after_json
  ) values (
    new.company_id, new.store_id, 'user', new.uploaded_by_user_id, 'import',
    'finance_report', new.id, 'upload',
    jsonb_build_object(
      'report_type', new.report_type,
      'report_date', new.report_date,
      'version', new.version,
      'sha256', new.sha256,
      'original_filename', new.original_filename
    )
  );
  return new;
end;
$$;

revoke execute on function zysyr_private.audit_finance_report_upload() from public, anon, authenticated, service_role;

drop trigger if exists zysyr_report_uploads_append_audit on public.zysyr_report_uploads;
create trigger zysyr_report_uploads_append_audit
after insert on public.zysyr_report_uploads
for each row execute function zysyr_private.audit_finance_report_upload();

alter table public.zysyr_voucher_attachments
  drop constraint if exists zysyr_voucher_attachments_record_type_check;

alter table public.zysyr_voucher_attachments
  add constraint zysyr_voucher_attachments_record_type_check
  check (record_type in ('expense', 'income', 'report'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zysyr-reports',
  'zysyr-reports',
  false,
  10485760,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into public.zysyr_capabilities (code, name, risk_level)
values ('report.upload', '上传门店日报、业绩表和月度盈亏表', 'sensitive')
on conflict (code) do update
set name = excluded.name,
    risk_level = excluded.risk_level,
    updated_at = now();

insert into public.zysyr_role_capabilities (role_id, capability_id)
select r.id, c.id
from public.zysyr_roles r
join public.zysyr_capabilities c on c.code = 'report.upload'
where r.code = 'finance'
on conflict (role_id, capability_id) do nothing;

alter table public.zysyr_report_uploads enable row level security;
alter table public.zysyr_report_uploads force row level security;

drop policy if exists zysyr_report_uploads_scope_select on public.zysyr_report_uploads;
create policy zysyr_report_uploads_scope_select
on public.zysyr_report_uploads for select to authenticated
using ((select zysyr_private.has_capability(company_id, store_id, 'dashboard.store.read')));

revoke all on table public.zysyr_report_uploads from public, anon, authenticated, service_role;
grant select on table public.zysyr_report_uploads to authenticated;
grant select, insert, update on table public.zysyr_report_uploads to service_role;

comment on table public.zysyr_report_uploads is
  'Append-preserving finance uploads. Each version keeps the original private file, digest, parsed display grid, uploader, company and store scope.';
comment on column public.zysyr_report_uploads.display_data is
  'A bounded display projection of the uploaded workbook. The immutable original private file remains the accounting evidence.';
