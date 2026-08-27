#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260820094055_zysyr_v2_sprint1_master_data.sql'),
  'utf8',
);
const employeeStoreMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260820095920_zysyr_sprint1_employee_store_management.sql'),
  'utf8',
);
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

function has(fragment) {
  return migration.includes(fragment);
}

['zysyr_service_items', 'zysyr_products', 'zysyr_suppliers'].forEach((table) => {
  expect(has(`create table public.${table}`), `${table} table missing`);
  expect(has(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(has(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
  expect(has(`revoke all on table public.${table} from public, anon, authenticated, service_role`), `${table} default grants not revoked`);
});

expect(has('company_id uuid not null references public.zysyr_companies(id) on delete restrict'), 'company tenant key missing');
expect(has('created_by_user_id uuid not null') && has('updated_by_user_id uuid not null'), 'actor provenance fields missing');
expect(has('deleted_at timestamptz') && has('deleted_by_user_id uuid'), 'soft-delete provenance fields missing');
expect(has('default_cost numeric(14,4)') && has('default_cost is null or default_cost >= 0'), 'product cost precision or guard missing');
expect(has('zysyr_service_items_company_name_uidx'), 'service-item natural-key guard missing');
expect(has('zysyr_products_company_name_uidx'), 'product natural-key guard missing');
expect(has('zysyr_suppliers_company_name_uidx'), 'supplier natural-key guard missing');
expect(has('zysyr_service_items_creator_idx') && has('zysyr_service_items_updater_idx'), 'service-item actor indexes missing');
expect(has('zysyr_products_creator_idx') && has('zysyr_products_updater_idx'), 'product actor indexes missing');
expect(has('zysyr_suppliers_creator_idx') && has('zysyr_suppliers_updater_idx'), 'supplier actor indexes missing');

expect(has('create or replace function zysyr_private.account_has_capability'), 'service-role capability verification missing');
expect(has('s.company_id = target_company_id') && has("s.status = 'active'"), 'write scope must validate active company/store mapping');
expect(has("urg.scope_type = 'company'") && has("urg.scope_type = 'store' and urg.store_id = target_store_id"), 'role store scope validation missing');
expect(has('public.zysyr_user_capability_grants ucg'), 'direct capability exception validation missing');
expect(has('create or replace function zysyr_private.has_company_catalog_access'), 'catalog read-scope helper missing');
expect(has("c.code in ('dashboard.group.read', 'dashboard.store.read', 'daily_report.write', 'inventory.write')"), 'catalog read role boundary missing');

expect(has('create or replace function public.zysyr_upsert_service_item'), 'service-item audited RPC missing');
expect(has('create or replace function public.zysyr_upsert_product'), 'product audited RPC missing');
expect(has('create or replace function public.zysyr_upsert_supplier'), 'supplier audited RPC missing');
expect(has("'daily_report.write'") && has("'inventory.write'"), 'master-data write capabilities missing');
expect(has('for update;') && has('CHANGE_REASON_REQUIRED'), 'concurrency lock or update reason guard missing');
expect(has('before_json, after_json, reason'), 'audit before/after/reason payload missing');
expect(has("p_actor_user_id, 'api',"), 'audited RPC channel must satisfy Sprint 0 constraint');
expect(has('to_jsonb(v_before)') && has('to_jsonb(v_after)'), 'audit snapshots missing');
expect(has('grant execute on function public.zysyr_upsert_service_item') && has('to service_role;'), 'service-item RPC service grant missing');
expect(!/grant execute on function public\.zysyr_upsert_[^;]+to authenticated;/i.test(migration), 'catalog write RPC must not be browser-executable');
expect(!/\bdelete\s+from\s+public\.zysyr_(?:service_items|products|suppliers)\b/i.test(migration), 'Sprint 1 must not physically delete catalog rows');
expect(!/\bdrop\s+(?:table|column|schema)\b/i.test(migration), 'Sprint 1 migration must stay additive');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'Sprint 1 catalog must not depend on Meiguanjia');

expect(api.includes('async function catalog(') && api.includes('operation === "catalog"'), 'catalog read API missing');
expect(api.includes('operation === "service_item_save"') && api.includes('rpc/zysyr_upsert_service_item'), 'service-item save API missing');
expect(api.includes('operation === "product_save"') && api.includes('rpc/zysyr_upsert_product'), 'product save API missing');
expect(api.includes('operation === "supplier_save"') && api.includes('rpc/zysyr_upsert_supplier'), 'supplier save API missing');
expect(api.includes('hasAuthCapability(session, "daily_report.write")'), 'service-item API capability gate missing');
expect(api.includes('hasAuthCapability(session, "inventory.write")'), 'inventory catalog API capability gate missing');
expect(api.includes('const store = await selectedStoreInfo(session, payload)'), 'catalog API must resolve authorized store scope');
expect(api.includes('p_actor_user_id: actorId') && api.includes('p_company_id: cleanText(store.company_id, 40)') && api.includes('p_store_id: cleanText(store.id, 40)'), 'catalog API provenance/scope binding missing');
expect(api.includes('catalogCostValue') && api.includes('最多四位小数'), 'product cost API precision validation missing');

function hasEmployeeStore(fragment) {
  return employeeStoreMigration.includes(fragment);
}

expect(hasEmployeeStore("('employee.write', '维护授权范围员工资料', 'sensitive')"), 'employee write capability missing');
expect(hasEmployeeStore("('org.store.write', '维护公司门店资料', 'high')"), 'store write capability missing');
expect(!hasEmployeeStore("('shareholder', 'org.store.write')"), 'store write must not be granted to every shareholder');
expect(hasEmployeeStore("creator_capability.code = 'finance_account.create'") && hasEmployeeStore("'inherited_from', 'finance_account.create'"), 'store write must inherit only the approved Gate C3 administrator boundary');
expect(hasEmployeeStore("'store_administrator_enabled'") && hasEmployeeStore("channel,\n  entity_type"), 'store administrator capability audit missing');
expect(hasEmployeeStore("('finance', 'employee.write')") && hasEmployeeStore("('store_manager', 'employee.write')"), 'employee write role mappings missing');
expect(hasEmployeeStore('created_by_user_id uuid') && hasEmployeeStore('updated_by_user_id uuid'), 'employee/store actor provenance columns missing');
expect(hasEmployeeStore('zysyr_stores_manager_employee_fkey'), 'store manager foreign key missing');
expect(hasEmployeeStore('zysyr_stores_manager_employee_idx'), 'store manager foreign-key index missing');
expect(hasEmployeeStore('create or replace function zysyr_private.account_has_company_capability'), 'company capability helper missing');
expect(hasEmployeeStore('create or replace function zysyr_private.account_has_capability') && hasEmployeeStore("company.status = 'active'"), 'active-company write guard missing');
expect(hasEmployeeStore("urg.scope_type = 'company'") && hasEmployeeStore("ucg.scope_type = 'company'"), 'company-only store permission guard missing');
expect(hasEmployeeStore('create or replace function public.zysyr_upsert_employee'), 'employee audited RPC missing');
expect(hasEmployeeStore('create or replace function public.zysyr_upsert_store'), 'store audited RPC missing');
expect(hasEmployeeStore("'employee.write'") && hasEmployeeStore("'org.store.write'"), 'employee/store RPC capability checks missing');
expect(hasEmployeeStore('v_before.store_id <> p_store_id') && hasEmployeeStore("'EMPLOYEE_SOURCE_STORE_FORBIDDEN'"), 'employee cross-store move guard missing');
expect(hasEmployeeStore("'employee', v_after.id") && hasEmployeeStore("'personal'"), 'employee personal audit event missing');
expect(hasEmployeeStore("'store', v_after.id") && hasEmployeeStore("p_actor_user_id, 'api'"), 'store audit event missing or channel invalid');
expect(hasEmployeeStore('to_jsonb(v_before)') && hasEmployeeStore('to_jsonb(v_after)'), 'employee/store audit snapshots missing');
expect(hasEmployeeStore('for update;') && hasEmployeeStore('CHANGE_REASON_REQUIRED'), 'employee/store update lock or reason missing');
expect(!/grant execute on function public\.zysyr_upsert_(?:employee|store)[^;]+to authenticated;/is.test(employeeStoreMigration), 'employee/store RPC must not be browser-executable');
expect(!/\bdelete\s+from\s+public\.zysyr_(?:employees|stores)\b/i.test(employeeStoreMigration), 'employee/store records must not be physically deleted');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(employeeStoreMigration), 'employee/store management must not depend on Meiguanjia');

expect(api.includes('operation === "employee_save"') && api.includes('rpc/zysyr_upsert_employee'), 'employee save API missing');
expect(api.includes('operation === "store_save"') && api.includes('rpc/zysyr_upsert_store'), 'store save API missing');
expect(api.includes('hasAuthCapability(session, "employee.write")'), 'employee API capability gate missing');
expect(api.includes('hasAuthCapability(session, "org.store.write")') && api.includes('auth_scope_type, 20) !== "company"'), 'store API company-scope capability gate missing');
expect(api.includes('async function createStore') && api.includes('return saveStore(payload, session)'), 'legacy store route must use the audited store RPC');
expect(api.includes('zysyr_employees?select=') && api.includes('store_id=eq.${cleanText(store.id, 40)}'), 'employee catalog must stay within selected store');
expect(api.includes('zysyr_stores?select=id,company_id,name,code,city,address,status'), 'company store catalog missing');

expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain the default home page');
expect(page.includes('id="view-catalog"') && page.includes('基础资料'), 'basic-data view missing');
expect(page.includes('data-catalog-tab="employees"') && page.includes('data-catalog-tab="stores"'), 'employee/store catalog tabs missing');
expect(page.includes("operation:'employee_save'") && page.includes("operation:'store_save'"), 'catalog forms are not wired to employee/store APIs');
expect(page.includes('停用与离职保留历史，不物理删除'), 'history-preserving UI boundary missing');
expect(!/data-view="revenue"|id="(?:turnover|revenue)-|mgj_service_records/.test(page), 'operations home must not restore turnover cards or Meiguanjia data');

console.log('ZYSYR Sprint 1 master-data and organization tests passed');
