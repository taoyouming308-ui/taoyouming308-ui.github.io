-- ZYSYR: shareholder "已阅/知晓" acknowledgement for monthly reports
create table if not exists public.zysyr_report_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  monthly_report_id uuid,
  user_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  unique (company_id, store_id, month, user_id),
  foreign key (company_id) references public.zysyr_companies(id) on delete restrict,
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, store_id, monthly_report_id) references public.zysyr_monthly_reports(company_id, store_id, id) on delete restrict
);

create or replace function public.zysyr_acknowledge_report(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_month text,
  p_monthly_report_id uuid
)
returns public.zysyr_report_acknowledgements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved public.zysyr_report_acknowledgements;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'REPORT_ACK_MONTH_INVALID';
  end if;
  insert into public.zysyr_report_acknowledgements (company_id, store_id, month, monthly_report_id, user_id)
  values (p_company_id, p_store_id, p_month, p_monthly_report_id, p_actor_user_id)
  on conflict (company_id, store_id, month, user_id)
  do update set monthly_report_id = excluded.monthly_report_id, acknowledged_at = now()
  returning * into v_saved;
  return v_saved;
end
$$;

grant execute on function public.zysyr_acknowledge_report(uuid, uuid, uuid, text, uuid) to service_role;
