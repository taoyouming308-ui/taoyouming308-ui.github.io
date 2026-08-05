-- v408: editable frontdesk-only assignment fields and audit metadata.
-- These columns never overwrite customer_profiles or Meiguanjia source records.

alter table public.frontdesk_today_customers
  add column if not exists technician_name text not null default '',
  add column if not exists assistant_name text not null default '',
  add column if not exists updated_by text not null default '';

alter table public.frontdesk_import_records
  add column if not exists updated_by text not null default '',
  add column if not exists updated_at timestamptz not null default now();

comment on column public.frontdesk_today_customers.technician_name is
  'Frontdesk-only technician assignment; does not change Meiguanjia.';
comment on column public.frontdesk_today_customers.assistant_name is
  'Frontdesk-only assistant assignment; does not change Meiguanjia.';
comment on column public.frontdesk_today_customers.updated_by is
  'Last frontdesk operator who edited the independent reception row.';
comment on column public.frontdesk_import_records.updated_by is
  'Last frontdesk operator who corrected editable ledger fields.';
comment on column public.frontdesk_import_records.updated_at is
  'Last correction time for the independent imported ledger row.';
