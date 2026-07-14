alter table public.mgj_service_records
  add column if not exists task_status text not null default 'pending',
  add column if not exists assigned_barber text not null default '',
  add column if not exists hair_record_id text,
  add column if not exists task_reason text not null default '',
  add column if not exists task_updated_at timestamptz;

alter table public.mgj_service_records
  drop constraint if exists mgj_service_records_task_status_check;

alter table public.mgj_service_records
  add constraint mgj_service_records_task_status_check
  check (task_status in ('pending', 'completed', 'exempt'));

create index if not exists mgj_service_records_task_idx
  on public.mgj_service_records (task_status, assigned_barber, service_date desc);
