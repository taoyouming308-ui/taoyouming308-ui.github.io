-- PostgREST now exposes the full JWT claims object on some requests without
-- populating the legacy request.jwt.claim.role setting. Keep the privileged
-- RPC boundary closed while accepting either representation.
set statement_timeout = '30s';
set lock_timeout = '5s';

create or replace function zysyr_private.request_role()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_legacy_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_claims_text text := coalesce(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
begin
  if v_legacy_role <> '' then
    return v_legacy_role;
  end if;
  if v_claims_text = '' then
    return '';
  end if;
  begin
    v_claims := v_claims_text::jsonb;
  exception when others then
    return '';
  end;
  return coalesce(v_claims->>'role', '');
end
$$;

revoke execute on function zysyr_private.request_role()
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_old_guard constant text :=
    'if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then';
  v_new_guard constant text :=
    'if zysyr_private.request_role() <> ''service_role'' then';
begin
  select pg_get_functiondef('public.zysyr_register_report_upload(jsonb,jsonb)'::regprocedure)
    into v_definition;
  v_patched := replace(v_definition, v_old_guard, v_new_guard);
  if v_patched = v_definition then
    raise exception 'zysyr_register_report_upload service-role guard was not found';
  end if;
  execute v_patched;

  select pg_get_functiondef(
    'public.zysyr_save_daily_attachment_orientation(uuid,uuid,uuid,uuid,uuid,smallint,text)'::regprocedure
  ) into v_definition;
  v_patched := replace(v_definition, v_old_guard, v_new_guard);
  if v_patched = v_definition then
    raise exception 'zysyr_save_daily_attachment_orientation service-role guard was not found';
  end if;
  execute v_patched;
end
$migration$;

comment on function zysyr_private.request_role() is
  'Returns the request role from legacy or full JWT claim settings for privileged RPC guards.';
