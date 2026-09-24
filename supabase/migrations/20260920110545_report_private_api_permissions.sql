-- These objects are internal operations-api resources. Authenticated business
-- access is checked by the Edge Function; no browser may call them directly.
-- Preserve service_role access and all existing data.
alter table public.zysyr_cash_opening_balances enable row level security;
alter table public.zysyr_report_acknowledgements enable row level security;
alter table public.zysyr_shareholder_registrations enable row level security;
revoke all on public.zysyr_cash_opening_balances,
  public.zysyr_report_acknowledgements, public.zysyr_shareholder_registrations
  from public, anon, authenticated;
grant all on public.zysyr_cash_opening_balances,
  public.zysyr_report_acknowledgements, public.zysyr_shareholder_registrations
  to service_role;

revoke execute on function public.zysyr_acknowledge_report(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke execute on function public.zysyr_admin_complete_shareholder_account(uuid,uuid,uuid,text,text,text,uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public.zysyr_record_petty_cash(uuid,uuid,uuid,date,text,text,text,numeric,uuid,uuid[],text,text,text)
  from public, anon, authenticated;
revoke execute on function public.zysyr_upsert_cash_opening_balance(uuid,uuid,uuid,text,numeric)
  from public, anon, authenticated;
grant execute on function public.zysyr_acknowledge_report(uuid,uuid,uuid,text,uuid),
  public.zysyr_admin_complete_shareholder_account(uuid,uuid,uuid,text,text,text,uuid,uuid),
  public.zysyr_record_petty_cash(uuid,uuid,uuid,date,text,text,text,numeric,uuid,uuid[],text,text,text),
  public.zysyr_upsert_cash_opening_balance(uuid,uuid,uuid,text,numeric)
  to service_role;
