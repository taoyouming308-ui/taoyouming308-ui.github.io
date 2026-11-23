-- Reproduction reference of the already installed RPC; not a new migration.
-- Additive read-only employee authority. No session renewal, row locks, grants
-- on existing tables, policies, passwords, customer rows or booking writes.
create function public.design_employee_verify_session(p_credential text,p_nonce uuid)
returns jsonb
language plpgsql security invoker volatile
set search_path=pg_catalog
set statement_timeout='2s'
set lock_timeout='100ms'
as $$
declare s record; e record; checked_at timestamptz; checked_ms bigint; expiry_ms bigint;
begin
  if current_user<>'service_role' or p_nonce is null or p_credential is null
    or length(p_credential) not between 32 and 200
    or p_credential ~ '[[:space:][:cntrl:]]' then
    raise exception 'DESIGN_EMPLOYEE_DENIED' using errcode='42501';
  end if;
  select username,store,created_at,expires_at into strict s
    from public.employee_booking_sessions
    where token_hash=encode(sha256(convert_to(p_credential,'UTF8')),'hex');
  select id,username,store,active,employment_status,created_at into strict e
    from public.staff where username=s.username;
  checked_at:=clock_timestamp();
  -- The username is the existing UNIQUE login key, never a display-name match.
  -- Bind the real staff PK and creation instant; an old session cannot cross a
  -- deleted/recreated account even if its login name is later reused.
  if e.id is null or e.id<=0 or e.active is distinct from true
    or e.employment_status is distinct from 'active'
    or e.store is distinct from s.store or e.store not in ('自由手艺人','向里造型')
    or e.username is null or length(e.username) not between 1 and 80
    or e.username<>btrim(e.username) or e.username ~ '[[:cntrl:]]'
    or e.created_at is null or s.created_at is null or e.created_at>s.created_at
    or s.created_at>checked_at or s.expires_at is null or s.expires_at<=checked_at then
    raise exception 'DESIGN_EMPLOYEE_DENIED' using errcode='42501';
  end if;
  checked_ms:=floor(extract(epoch from checked_at)*1000)::bigint;
  expiry_ms:=floor(extract(epoch from s.expires_at)*1000)::bigint;
  if expiry_ms<=checked_ms or expiry_ms>9007199254740991 then
    raise exception 'DESIGN_EMPLOYEE_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object(
    'schemaVersion','design-live-employee-v1','nonce',p_nonce::text,
    'staffId',e.id::text,
    'staffCreatedAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor',jsonb_build_object('username',e.username,'store',e.store),
    'sessionBinding',encode(sha256(convert_to('design-live-employee-v1:'||p_credential,'UTF8')),'hex'),
    'sourceRevision',encode(sha256(convert_to(jsonb_build_object('id',e.id,'username',e.username,'store',e.store,'createdAt',e.created_at,'active',e.active,'employmentStatus',e.employment_status)::text,'UTF8')),'hex'),
    'checkedAt',checked_ms,'sessionExpiresAt',expiry_ms,
    'validUntil',least(expiry_ms,checked_ms+5000));
exception when no_data_found or too_many_rows then
  raise exception 'DESIGN_EMPLOYEE_DENIED' using errcode='42501';
end $$;
revoke all on function public.design_employee_verify_session(text,uuid) from public,anon,authenticated;
grant execute on function public.design_employee_verify_session(text,uuid) to service_role;
comment on function public.design_employee_verify_session(text,uuid) is
  'Server-only fresh verification of the current employee app session; SELECT only, no renewal, no assignment/customer permission.';
