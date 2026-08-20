-- ZYSYR V2 Gate B: approved company, store and legacy staff mapping.
-- This migration deliberately does not create Auth users, user accounts or
-- role/capability grants. It also leaves the legacy staff table unchanged.

set statement_timeout = '30s';
set lock_timeout = '5s';

do $$
declare
  v_company_id uuid;
  v_count bigint;
  v_staff_before bigint;
  v_mgj_before bigint;
  v_sessions_before bigint;
  v_expenses_before bigint;
  v_vouchers_before bigint;
  v_auth_before bigint;
begin
  -- Keep the source snapshot and the new mapping tables stable for this short
  -- transaction. The five-second lock timeout fails closed instead of blocking
  -- normal operations for an extended period.
  lock table public.staff in share mode;
  lock table public.zysyr_stores in share row exclusive mode;
  lock table public.zysyr_companies in share row exclusive mode;
  lock table public.zysyr_employees in share row exclusive mode;
  lock table public.zysyr_employee_store_assignments in share row exclusive mode;
  lock table public.zysyr_legacy_id_map in share row exclusive mode;
  lock table public.zysyr_audit_events in row exclusive mode;

  select count(*) into v_staff_before from public.staff;
  select count(*) into v_mgj_before from public.mgj_service_records;
  select count(*) into v_sessions_before from public.zysyr_operations_sessions;
  select count(*) into v_expenses_before from public.zysyr_expense_records;
  select count(*) into v_vouchers_before from public.zysyr_voucher_attachments;
  select count(*) into v_auth_before from auth.users;

  -- The live operational tables can legitimately grow between approval and
  -- deployment. Capture them for the final no-change check, but only fail the
  -- precondition on mapping-critical source state.
  if v_staff_before <> 28 or v_auth_before <> 0 then
    raise exception 'Gate B mapping baseline drifted: staff %, auth %',
      v_staff_before, v_auth_before;
  end if;

  select count(*) into v_count from public.zysyr_companies;
  if v_count <> 0 then
    raise exception 'Gate B requires an empty company table; found % rows', v_count;
  end if;

  select count(*) into v_count from public.zysyr_stores;
  if v_count <> 2
     or not exists (
       select 1 from public.zysyr_stores
       where name = '向里造型' and status = 'active'
         and company_id is null and code is null
     )
     or not exists (
       select 1 from public.zysyr_stores
       where name = '自由手艺人' and status = 'active'
         and company_id is null and code is null
     )
     or exists (
       select 1 from public.zysyr_stores
       where name not in ('向里造型', '自由手艺人')
     ) then
    raise exception 'Gate B store baseline drifted';
  end if;

  select count(*) into v_count
  from public.staff
  where nullif(btrim(store), '') is not null;
  if v_count <> 27 then
    raise exception 'Gate B expected 27 store-mapped staff rows; found %', v_count;
  end if;

  select count(*) into v_count
  from public.staff
  where nullif(btrim(store), '') is not null
    and coalesce(active, false)
    and employment_status = 'active';
  if v_count <> 24 then
    raise exception 'Gate B expected 24 active mapped staff rows; found %', v_count;
  end if;

  select count(*) into v_count
  from public.staff
  where nullif(btrim(store), '') is not null
    and not coalesce(active, false)
    and employment_status = 'departed';
  if v_count <> 3 then
    raise exception 'Gate B expected 3 departed mapped staff rows; found %', v_count;
  end if;

  select count(*) into v_count
  from public.staff
  where nullif(btrim(store), '') is null;
  if v_count <> 1
     or not exists (
       select 1 from public.staff
       where id = 26 and username = 'test_staff'
         and role = 'staff' and position = '发型师'
         and coalesce(active, false) and employment_status = 'active'
         and nullif(btrim(store), '') is null
     ) then
    raise exception 'Gate B excluded test_staff baseline drifted';
  end if;

  if exists (
       select 1 from public.mgj_service_records
       where 'test_staff' = any(staff) or assigned_barber = 'test_staff'
     )
     or exists (
       select 1 from public.hair_records
       where barber = 'test_staff' or technician = 'test_staff'
     )
     or exists (
       select 1 from public.care_records where barber = 'test_staff'
     )
     or exists (
       select 1 from public.bookings where barber_name = 'test_staff'
     )
     or exists (
       select 1 from public.zysyr_operations_sessions where username = 'test_staff'
     ) then
    raise exception 'Gate B excluded test_staff now has business usage';
  end if;

  if exists (
       select 1 from public.staff
       where nullif(btrim(store), '') is not null
         and btrim(store) not in ('向里造型', '自由手艺人')
     )
     or exists (
       select 1 from public.staff
       where nullif(btrim(store), '') is not null
         and not (
           (coalesce(active, false) and employment_status = 'active')
           or (not coalesce(active, false) and employment_status = 'departed')
         )
     ) then
    raise exception 'Gate B found an unsupported store or employment state';
  end if;

  if (select count(*) from public.zysyr_employees) <> 0
     or (select count(*) from public.zysyr_employee_store_assignments) <> 0
     or exists (
       select 1 from public.zysyr_legacy_id_map
       where source_table = 'staff' and target_table = 'zysyr_employees'
     )
     or (select count(*) from public.zysyr_user_accounts) <> 0
     or (select count(*) from public.zysyr_user_role_grants) <> 0
     or (select count(*) from public.zysyr_user_capability_grants) <> 0 then
    raise exception 'Gate B target tables are not in the approved empty state';
  end if;

  insert into public.zysyr_companies (code, name, status)
  values ('zysyr', 'ZYSYR', 'active')
  returning id into v_company_id;

  update public.zysyr_stores
  set company_id = v_company_id,
      code = case name
        when '向里造型' then 'xiangli'
        when '自由手艺人' then 'ziyou'
      end,
      updated_at = now()
  where name in ('向里造型', '自由手艺人');
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'Gate B expected to update 2 stores; updated %', v_count;
  end if;

  insert into public.zysyr_employees (
    company_id,
    store_id,
    employee_code,
    name,
    position,
    join_date,
    leave_date,
    employment_status
  )
  select
    v_company_id,
    zs.id,
    'legacy_staff_' || s.id::text,
    s.username,
    coalesce(nullif(btrim(s.position), ''), '未填写'),
    null,
    null,
    case
      when coalesce(s.active, false) and s.employment_status = 'active' then 'active'
      else 'departed'
    end
  from public.staff s
  join public.zysyr_stores zs
    on zs.company_id = v_company_id
   and zs.name = btrim(s.store)
  where nullif(btrim(s.store), '') is not null
  order by s.id;
  get diagnostics v_count = row_count;
  if v_count <> 27 then
    raise exception 'Gate B expected to insert 27 employees; inserted %', v_count;
  end if;

  insert into public.zysyr_employee_store_assignments (
    company_id,
    store_id,
    employee_id,
    assignment_type,
    effective_from
  )
  select
    e.company_id,
    e.store_id,
    e.id,
    'primary',
    current_date
  from public.zysyr_employees e
  where e.company_id = v_company_id
    and e.employment_status = 'active'
  order by e.employee_code;
  get diagnostics v_count = row_count;
  if v_count <> 24 then
    raise exception 'Gate B expected to insert 24 active assignments; inserted %', v_count;
  end if;

  insert into public.zysyr_legacy_id_map (
    company_id,
    source_table,
    source_key,
    target_table,
    target_id,
    mapping_status,
    note
  )
  select
    v_company_id,
    'staff',
    s.id::text,
    'zysyr_employees',
    e.id,
    'mapped',
    'Gate B approved legacy staff mapping; passwords excluded'
  from public.staff s
  join public.zysyr_employees e
    on e.company_id = v_company_id
   and e.employee_code = 'legacy_staff_' || s.id::text
  where nullif(btrim(s.store), '') is not null
  order by s.id;
  get diagnostics v_count = row_count;
  if v_count <> 27 then
    raise exception 'Gate B expected to insert 27 legacy maps; inserted %', v_count;
  end if;

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
  values (
    v_company_id,
    'system',
    'codex_gate_b_mapping',
    'migration',
    'company_mapping',
    v_company_id,
    'bootstrap_legacy_mapping',
    jsonb_build_object(
      'company_code', 'zysyr',
      'store_count', 2,
      'employee_count', 27,
      'active_assignment_count', 24,
      'legacy_map_count', 27,
      'excluded_staff_ids', jsonb_build_array(26)
    ),
    'User-approved Gate B company, store and employee mapping',
    'personal'
  );

  if (select count(*) from public.zysyr_companies where id = v_company_id and code = 'zysyr' and name = 'ZYSYR' and status = 'active') <> 1
     or (select count(*) from public.zysyr_stores where company_id = v_company_id and code in ('xiangli', 'ziyou')) <> 2
     or (select count(*) from public.zysyr_employees where company_id = v_company_id) <> 27
     or (select count(*) from public.zysyr_employees where company_id = v_company_id and employment_status = 'active') <> 24
     or (select count(*) from public.zysyr_employees where company_id = v_company_id and employment_status = 'departed') <> 3
     or (select count(*) from public.zysyr_employee_store_assignments where company_id = v_company_id and effective_to is null) <> 24
     or (select count(*) from public.zysyr_legacy_id_map where company_id = v_company_id and source_table = 'staff' and target_table = 'zysyr_employees' and mapping_status = 'mapped') <> 27
     or exists (select 1 from public.zysyr_employees where employee_code = 'legacy_staff_26')
     or exists (select 1 from public.zysyr_legacy_id_map where source_table = 'staff' and source_key = '26' and target_table = 'zysyr_employees')
     or (select count(*) from public.zysyr_audit_events where company_id = v_company_id and action = 'bootstrap_legacy_mapping') <> 1 then
    raise exception 'Gate B postcondition failed';
  end if;

  if (select count(*) from public.staff) <> v_staff_before
     or (select count(*) from public.mgj_service_records) <> v_mgj_before
     or (select count(*) from public.zysyr_operations_sessions) <> v_sessions_before
     or (select count(*) from public.zysyr_expense_records) <> v_expenses_before
     or (select count(*) from public.zysyr_voucher_attachments) <> v_vouchers_before
     or (select count(*) from auth.users) <> v_auth_before
     or (select count(*) from public.zysyr_user_accounts) <> 0
     or (select count(*) from public.zysyr_user_role_grants) <> 0
     or (select count(*) from public.zysyr_user_capability_grants) <> 0 then
    raise exception 'Gate B protected table counts changed unexpectedly';
  end if;
end
$$;
