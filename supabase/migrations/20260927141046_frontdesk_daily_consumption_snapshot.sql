-- Complete, read-only Meiguanjia project-bill snapshots, NOT hair reconciliation.
create table public.mgj_daily_consumption (
  shop_name text not null check (shop_name in ('自由手艺人', '向里造型')),
  business_date date not null,
  services jsonb not null check (jsonb_typeof(services) = 'array' and jsonb_array_length(services) <= 1000),
  fetched_at timestamptz not null,
  primary key (shop_name, business_date)
);
alter table public.mgj_daily_consumption enable row level security;
revoke all on public.mgj_daily_consumption from public, anon, authenticated;
grant select, insert, update on public.mgj_daily_consumption to service_role;

-- One atomic store/day replacement, including a verified empty day. Older fetches
-- cannot overwrite a newer successful snapshot; failures never call this RPC.
create function public.write_mgj_daily_consumption(
  p_shop text, p_date date, p_services jsonb, p_fetched_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  insert into public.mgj_daily_consumption(shop_name, business_date, services, fetched_at)
  values (p_shop, p_date, p_services, p_fetched_at)
  on conflict (shop_name, business_date) do update
    set services = excluded.services, fetched_at = excluded.fetched_at
    where excluded.fetched_at >= public.mgj_daily_consumption.fetched_at;
  get diagnostics changed = row_count;
  return jsonb_build_object('written', changed, 'count', jsonb_array_length(p_services));
end;
$$;
revoke all on function public.write_mgj_daily_consumption(text, date, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.write_mgj_daily_consumption(text, date, jsonb, timestamptz) to service_role;
