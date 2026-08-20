#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '../supabase/migrations/20260811033600_zysyr_gate_b_company_store_employee_mapping.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

function has(fragment) {
  return sql.includes(fragment);
}

expect(has("set statement_timeout = '30s'"), 'short statement timeout missing');
expect(has("set lock_timeout = '5s'"), 'short lock timeout missing');
expect(has("values ('zysyr', 'ZYSYR', 'active')"), 'approved company mapping missing');
expect(has("when '向里造型' then 'xiangli'"), '向里造型 store code missing');
expect(has("when '自由手艺人' then 'ziyou'"), '自由手艺人 store code missing');
expect(has("v_count <> 27"), '27 mapped employees guard missing');
expect(has("v_count <> 24"), '24 active assignments guard missing');
expect(has("employment_status = 'departed') <> 3"), '3 departed employees postcondition missing');
expect(has("'legacy_staff_' || s.id::text"), 'legacy employee code mapping missing');
expect(has('insert into public.zysyr_legacy_id_map'), 'legacy ID map insert missing');
expect(has("where id = 26 and username = 'test_staff'"), 'test_staff exclusion precondition missing');
expect(has("jsonb_build_array(26)"), 'test_staff exclusion audit evidence missing');
expect(has("'bootstrap_legacy_mapping'"), 'append-only audit action missing');
expect(has('join_date,\n    leave_date'), 'employment date fields missing');
expect(has("    null,\n    null,\n    case"), 'unknown employment dates must remain null');
expect(has('returning id into v_company_id'), 'generated company ID capture missing');
expect(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(sql), 'migration must not hardcode UUIDs');

expect(!/insert\s+into\s+auth\.users/i.test(sql), 'Gate B must not create Auth users');
expect(!/insert\s+into\s+public\.zysyr_user_accounts/i.test(sql), 'Gate B must not create user accounts');
expect(!/insert\s+into\s+public\.zysyr_user_role_grants/i.test(sql), 'Gate B must not create role grants');
expect(!/insert\s+into\s+public\.zysyr_user_capability_grants/i.test(sql), 'Gate B must not create capability grants');
expect(!/update\s+public\.staff/i.test(sql), 'Gate B must not update legacy staff');
expect(!/\bdelete\s+from\b/i.test(sql), 'Gate B must not delete rows');
expect(!/\btruncate\b/i.test(sql), 'Gate B must not truncate rows');
expect(!/\bdrop\s+(?:table|column|schema)\b/i.test(sql), 'Gate B must not drop schema objects');

expect(!has('v_mgj_before <> 1080'), 'live Meiguanjia count must not be a fixed precondition');
expect(has('(select count(*) from public.mgj_service_records) <> v_mgj_before'), 'Meiguanjia no-change postcondition missing');
expect(has('(select count(*) from auth.users) <> v_auth_before'), 'Auth no-change postcondition missing');

console.log('ZYSYR Gate B mapping tests passed');
