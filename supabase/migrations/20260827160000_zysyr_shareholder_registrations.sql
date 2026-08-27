-- ZYSYR: shareholder self-registration requests (reviewed by boss in cockpit)
create table if not exists public.zysyr_shareholder_registrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  login_name text not null,
  display_name text not null,
  auth_user_id uuid,
  scope_type text not null default 'company' check (scope_type in ('company', 'store')),
  store_id uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  foreign key (company_id) references public.zysyr_companies(id) on delete restrict,
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, reviewed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict
);

create index if not exists zysyr_shareholder_registrations_pending_idx
  on public.zysyr_shareholder_registrations (company_id, status, requested_at desc);
