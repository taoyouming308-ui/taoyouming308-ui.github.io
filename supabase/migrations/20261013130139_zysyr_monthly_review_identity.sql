-- Confirmation identity only. This is NOT an authentication/account merger.
-- No grants, financial records, old acknowledgements or automatic confirmations
-- are changed. Explicitly verified aliases are enrolled separately before use.
create table public.zysyr_monthly_review_identity_links (
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  staff_id integer not null references public.staff(id) on delete restrict,
  user_account_id uuid not null,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  linked_at timestamptz not null default now(),
  primary key (company_id, staff_id),
  unique (staff_id),
  unique (company_id, user_account_id),
  foreign key (company_id,user_account_id)
    references public.zysyr_user_accounts(company_id,id) on delete restrict
);
alter table public.zysyr_monthly_review_identity_links enable row level security;
alter table public.zysyr_monthly_review_identity_links force row level security;
revoke all on public.zysyr_monthly_review_identity_links from public,anon,authenticated,service_role;
grant select on public.zysyr_monthly_review_identity_links to service_role;

create function zysyr_private.monthly_review_identity_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'MONTHLY_REVIEW_IDENTITY_IMMUTABLE';
end $$;
revoke all on function zysyr_private.monthly_review_identity_immutable() from public,anon,authenticated;
create trigger monthly_review_identity_immutable before update or delete
  on public.zysyr_monthly_review_identity_links for each row
  execute function zysyr_private.monthly_review_identity_immutable();

-- The caller must authenticate first. Only the trusted Edge service can invoke
-- this resolver, using server-derived IDs, never IDs/roles supplied by a client.
-- Each entrance retains its OWN live store permission. Linking a staff login
-- never inherits the linked account's company-wide permission (or vice versa).
create function public.zysyr_monthly_review_identity(
  p_company_id uuid,p_store_id uuid,
  p_user_account_id uuid default null,p_staff_id integer default null
) returns text language plpgsql stable security invoker
set search_path=pg_catalog,public,zysyr_private as $$
declare linked_account uuid;
begin
  if (p_user_account_id is null)=(p_staff_id is null) then
    raise exception 'MONTHLY_REVIEW_IDENTITY_INVALID';
  end if;
  if not exists(select 1 from public.zysyr_stores s
    where s.company_id=p_company_id and s.id=p_store_id and s.status='active') then
    raise exception 'MONTHLY_REVIEW_STORE_DENIED';
  end if;
  if p_staff_id is not null then
    if not exists(select 1 from public.staff s
      join public.staff_report_grants g on g.staff_id=s.id
      where s.id=p_staff_id and s.active is true and s.employment_status='active'
        and g.store_id=p_store_id) then
      raise exception 'MONTHLY_REVIEW_STAFF_DENIED';
    end if;
    select l.user_account_id into linked_account
      from public.zysyr_monthly_review_identity_links l
      where l.company_id=p_company_id and l.staff_id=p_staff_id;
    -- Retain the stable identity even if the other login is later suspended:
    -- suspension of that entrance must neither grant nor revoke this entrance.
    return case when linked_account is null then 'staff:'||p_staff_id::text
      else 'account:'||linked_account::text end;
  end if;
  if not exists(select 1 from public.zysyr_user_accounts a
    join public.zysyr_user_role_grants g on g.company_id=a.company_id and g.user_account_id=a.id
    join public.zysyr_roles r on r.id=g.role_id
    where a.company_id=p_company_id and a.id=p_user_account_id and a.status='active'
      and r.code='shareholder' and g.revoked_at is null
      and g.valid_from <= (now() at time zone 'Asia/Shanghai')::date
      and (g.valid_to is null or g.valid_to >= (now() at time zone 'Asia/Shanghai')::date)
      and (g.scope_type='company' or (g.scope_type='store' and g.store_id=p_store_id))) then
    raise exception 'MONTHLY_REVIEW_ACCOUNT_DENIED';
  end if;
  return 'account:'||p_user_account_id::text;
end $$;
revoke all on function public.zysyr_monthly_review_identity(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.zysyr_monthly_review_identity(uuid,uuid,uuid,integer) to service_role;

-- Publication uses these identities to freeze its recipient set. DISTINCT ON
-- deduplicates only an explicit identity link; equal display names never merge.
-- This private helper is not a browser endpoint or a substitute for finance auth.
create function zysyr_private.monthly_review_recipients(p_company_id uuid,p_store_id uuid)
returns table(person_key text,display_name text) language sql stable security invoker
set search_path=pg_catalog,public,zysyr_private as $$
  with candidates as (
    select 'account:'||a.id::text as person_key,a.display_name,0 as priority
    from public.zysyr_user_accounts a
    where a.company_id=p_company_id and a.status='active' and exists(
      select 1 from public.zysyr_user_role_grants g
      join public.zysyr_roles r on r.id=g.role_id
      where g.company_id=a.company_id and g.user_account_id=a.id and r.code='shareholder'
        and g.revoked_at is null
        and g.valid_from <= (now() at time zone 'Asia/Shanghai')::date
        and (g.valid_to is null or g.valid_to >= (now() at time zone 'Asia/Shanghai')::date)
        and (g.scope_type='company' or (g.scope_type='store' and g.store_id=p_store_id)))
    union all
    select case when l.user_account_id is null then 'staff:'||s.id::text
      else 'account:'||l.user_account_id::text end,s.username,1
    from public.staff s join public.staff_report_grants g on g.staff_id=s.id
    left join public.zysyr_monthly_review_identity_links l on l.staff_id=s.id and l.company_id=p_company_id
    where g.store_id=p_store_id and s.active is true and s.employment_status='active'
  )
  select distinct on (c.person_key) c.person_key,c.display_name from candidates c
  where exists(select 1 from public.zysyr_stores s
    where s.id=p_store_id and s.company_id=p_company_id and s.status='active')
  order by c.person_key,c.priority;
$$;
revoke all on function zysyr_private.monthly_review_recipients(uuid,uuid) from public,anon,authenticated;
grant execute on function zysyr_private.monthly_review_recipients(uuid,uuid) to service_role;
