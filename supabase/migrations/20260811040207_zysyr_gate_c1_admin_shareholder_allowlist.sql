-- ZYSYR V2 Gate C1: explicitly approve only the two existing administrators
-- for rolling username/password migration as company-scoped shareholders.
-- This migration does not create Auth users, accounts, or role grants; those
-- are created only after each approved user supplies the correct old password.

set statement_timeout = '30s';
set lock_timeout = '5s';

do $$
declare
  v_company_id uuid;
  v_role_id uuid;
  v_candidate_count integer;
  v_inserted_count integer;
  v_shareholder_capabilities text[];
begin
  if (select count(*) from auth.users) <> 0
     or (select count(*) from public.zysyr_user_accounts) <> 0
     or (select count(*) from public.zysyr_user_role_grants where revoked_at is null) <> 0
     or (select count(*) from public.zysyr_auth_migration_allowlist) <> 0 then
    raise exception 'Gate C1 requires empty Auth users, V2 accounts, active role grants, and migration allowlist';
  end if;

  select id into strict v_company_id
  from public.zysyr_companies
  where code = 'zysyr' and status = 'active';

  select id into strict v_role_id
  from public.zysyr_roles
  where code = 'shareholder' and status = 'active';

  select array_agg(cap.code order by cap.code)
  into v_shareholder_capabilities
  from public.zysyr_role_capabilities rc
  join public.zysyr_capabilities cap on cap.id = rc.capability_id
  where rc.role_id = v_role_id;

  if v_shareholder_capabilities is distinct from array[
    'ai_insight.read',
    'audit.read',
    'dashboard.group.read',
    'dashboard.store.read',
    'question.create',
    'salary.read',
    'voucher.read'
  ]::text[] then
    raise exception 'Gate C1 shareholder capability matrix has drifted';
  end if;

  select count(*) into v_candidate_count
  from public.staff s
  join public.zysyr_legacy_id_map m
    on m.company_id = v_company_id
   and m.source_table = 'staff'
   and m.source_key = s.id::text
   and m.target_table = 'zysyr_employees'
   and m.mapping_status = 'mapped'
  join public.zysyr_employees e
    on e.company_id = v_company_id
   and e.id = m.target_id
   and e.employment_status = 'active'
   and e.deleted_at is null
  join public.zysyr_stores st
    on st.company_id = v_company_id
   and st.id = e.store_id
   and st.status = 'active'
  where (s.username, st.code) in (('admin', 'ziyou'), ('哈维', 'xiangli'))
    and s.role = 'admin'
    and s.active is true
    and s.employment_status = 'active';

  if v_candidate_count <> 2 then
    raise exception 'Gate C1 expected exactly two approved active administrator mappings, found %', v_candidate_count;
  end if;

  if exists (
    select 1
    from public.staff
    where active is true
      and employment_status = 'active'
      and lower(btrim(username)) in ('admin', lower('哈维'))
    group by lower(btrim(username))
    having count(*) <> 1
  ) then
    raise exception 'Gate C1 approved login name is not unique';
  end if;

  with inserted as (
    insert into public.zysyr_auth_migration_allowlist (
      company_id,
      employee_id,
      legacy_staff_id,
      login_name,
      role_id,
      scope_type,
      store_id,
      status,
      approved_by,
      approval_reason,
      approval_reference
    )
    select
      v_company_id,
      e.id,
      s.id,
      s.username,
      v_role_id,
      'company',
      null,
      'approved',
      'ZYSYR shareholder approval via Codex',
      'Gate C1 approved two existing administrators for rolling username/password migration as company-scoped shareholders; dashboard page remains on the legacy login.',
      'codex-task-2026-08-11-gate-c1'
    from public.staff s
    join public.zysyr_legacy_id_map m
      on m.company_id = v_company_id
     and m.source_table = 'staff'
     and m.source_key = s.id::text
     and m.target_table = 'zysyr_employees'
     and m.mapping_status = 'mapped'
    join public.zysyr_employees e
      on e.company_id = v_company_id
     and e.id = m.target_id
     and e.employment_status = 'active'
     and e.deleted_at is null
    join public.zysyr_stores st
      on st.company_id = v_company_id
     and st.id = e.store_id
     and st.status = 'active'
    where (s.username, st.code) in (('admin', 'ziyou'), ('哈维', 'xiangli'))
      and s.role = 'admin'
      and s.active is true
      and s.employment_status = 'active'
    returning *
  ), audited as (
    insert into public.zysyr_audit_events (
      company_id,
      actor_type,
      service_actor,
      channel,
      entity_type,
      entity_id,
      action,
      after_json,
      reason,
      sensitivity
    )
    select
      i.company_id,
      'system',
      'codex_gate_c1_migration',
      'migration',
      'auth_migration_allowlist',
      i.id,
      'auth_migration_allowlisted',
      jsonb_build_object(
        'employee_id', i.employee_id,
        'legacy_staff_id', i.legacy_staff_id,
        'login_name', i.login_name,
        'role_code', 'shareholder',
        'scope_type', i.scope_type,
        'store_id', i.store_id,
        'approval_reference', i.approval_reference
      ),
      i.approval_reason,
      'personal'
    from inserted i
    returning 1
  )
  select count(*) into v_inserted_count from audited;

  if v_inserted_count <> 2 then
    raise exception 'Gate C1 expected two allowlist audit events, created %', v_inserted_count;
  end if;

  if (select count(*) from auth.users) <> 0
     or (select count(*) from public.zysyr_user_accounts) <> 0
     or (select count(*) from public.zysyr_user_role_grants where revoked_at is null) <> 0 then
    raise exception 'Gate C1 allowlist migration must not create Auth users, accounts, or role grants';
  end if;
end
$$;
