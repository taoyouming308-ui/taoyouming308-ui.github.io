#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260811024016_zysyr_v2_sprint0_auth_rbac_audit.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

function has(fragment) {
  return sql.includes(fragment);
}

const requiredTables = [
  'zysyr_companies',
  'zysyr_roles',
  'zysyr_capabilities',
  'zysyr_role_capabilities',
  'zysyr_employees',
  'zysyr_user_accounts',
  'zysyr_user_role_grants',
  'zysyr_user_capability_grants',
  'zysyr_employee_store_assignments',
  'zysyr_audit_events',
  'zysyr_workflow_events',
  'zysyr_period_locks',
  'zysyr_period_lock_events',
  'zysyr_trace_nodes',
  'zysyr_trace_edges',
  'zysyr_legacy_id_map',
  'zysyr_voucher_links',
];

requiredTables.forEach((table) => {
  expect(has(`create table if not exists public.${table}`), `${table} table missing`);
  expect(has(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(has(`revoke all on table public.${table} from public, anon, authenticated, service_role`), `${table} explicit revoke missing`);
});

expect(has('references auth.users(id)'), 'Supabase Auth mapping missing');
expect(!/auth\.jwt\(\)[\s\S]{0,120}(?:user_metadata|raw_user_meta_data)/i.test(sql), 'user-editable metadata must not authorize access');
expect(has('create schema if not exists zysyr_private'), 'private RLS helper schema missing');
expect(has('security definer\nset search_path = \'\''), 'security-definer helpers must pin an empty search_path');
expect(has('(select auth.uid()) is not null'), 'RLS helpers must verify the caller identity');
expect(has('grant usage on schema zysyr_private to authenticated'), 'authenticated policy helper access missing');

expect(has("scope_type text not null check (scope_type in ('company', 'store'))"), 'explicit scope type missing');
expect(has("(scope_type = 'company' and store_id is null)"), 'company-scope invariant missing');
expect(has("(scope_type = 'store' and store_id is not null)"), 'store-scope invariant missing');
expect(has('foreign key (company_id, store_id)'), 'composite tenant foreign keys missing');
expect(has('zysyr_user_role_scope_lookup_idx'), 'role-scope RLS index missing');
expect(has('zysyr_user_capability_scope_lookup_idx'), 'capability-scope RLS index missing');

expect(!has("('shareholder', 'expense.create_submit')"), 'shareholder must not create expenses in V2');
expect(!has("('shareholder', 'expense.approve')"), 'shareholder must not approve expenses in V2');
expect(!has("('shareholder', 'voucher.upload')"), 'shareholder must not upload vouchers in V2');
expect(has("('finance', 'expense.create_submit')"), 'finance expense entry capability missing');
expect(has("('finance', 'expense.approve')"), 'finance expense approval capability missing');
expect(has("('store_manager', 'expense.create_submit')"), 'store manager submit capability missing');
expect(!has("('store_manager', 'expense.approve')"), 'store manager must not approve expenses');

['zysyr_audit_events', 'zysyr_workflow_events', 'zysyr_period_lock_events'].forEach((table) => {
  expect(has(`create trigger ${table}_immutable`), `${table} immutability trigger missing`);
});
expect(has("raise exception 'ZYSYR event tables are append-only'"), 'append-only database guard missing');
expect(has('grant select, insert on table\n  public.zysyr_audit_events'), 'audit service grant must be insert/select only');
expect(!/grant[\s\S]{0,80}update[\s\S]{0,80}public\.zysyr_audit_events/i.test(sql), 'audit UPDATE grant is forbidden');
expect(!/grant[\s\S]{0,80}delete[\s\S]{0,80}public\.zysyr_audit_events/i.test(sql), 'audit DELETE grant is forbidden');

expect(has('alter table public.zysyr_expense_records\n  add column if not exists company_id uuid'), 'legacy expense tenant bridge missing');
expect(has('alter table public.zysyr_voucher_attachments\n  add column if not exists company_id uuid'), 'legacy voucher tenant bridge missing');
expect(has("check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')"), 'voucher digest validation missing');
expect(has('Trace graph foundation. Direct writes remain disabled'), 'Trace write gate missing');

expect(!/\bdrop\s+table\b/i.test(sql), 'Sprint 0 migration must not drop tables');
expect(!/\btruncate\b/i.test(sql), 'Sprint 0 migration must not truncate data');
expect(!/alter\s+column[\s\S]{0,80}\btype\b/i.test(sql), 'Sprint 0 migration must not rewrite legacy column types');
expect(!/alter\s+column[\s\S]{0,80}set\s+not\s+null/i.test(sql), 'Sprint 0 migration must not force legacy mappings before reconciliation');

console.log('ZYSYR Sprint 0 schema tests passed');
