#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828020852_zysyr_monthly_finance_audit_closure.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

for (const table of [
  'zysyr_monthly_cell_unlock_requests',
  'zysyr_monthly_cell_revisions',
  'zysyr_monthly_cell_revision_vouchers',
]) {
  expect(migration.includes(`create table public.${table}`), `${table} missing`);
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
}
expect(migration.includes('delta numeric(18,4) generated always'), 'exact revision delta missing');
expect(migration.includes('zysyr_monthly_cell_revisions_append_only'), 'amount history append-only trigger missing');
expect(migration.includes('zysyr_monthly_cell_revision_vouchers_append_only'), 'voucher history append-only trigger missing');
expect(migration.includes('MONTHLY_FORMULA_EDIT_FORBIDDEN'), 'formula/total edit rejection missing');
expect(migration.includes('MONTHLY_CELL_AGGREGATE_EDIT_FORBIDDEN'), 'derived aggregate edit rejection missing');
expect(migration.includes('MONTHLY_UNLOCK_SELF_APPROVAL_FORBIDDEN'), 'four-eyes locked-month approval missing');
expect(migration.includes("set status = 'consumed', consumed_at = now()"), 'one-time unlock consumption missing');
expect(migration.includes("'monthly_report_cell', v_cell.id, 'amount_change'"), 'before/after audit event missing');
expect(migration.includes("'monthly_report_cell', v_cell.id, 'voucher_link'"), 'cell voucher audit event missing');
expect(!(migration.match(/^grant execute on function public\.zysyr_.*monthly.*to authenticated;$/gim) || []).length, 'browser write RPC grant found');
for (const name of [
  'zysyr_request_monthly_cell_unlock',
  'zysyr_decide_monthly_cell_unlock',
  'zysyr_revise_monthly_cells',
  'zysyr_attach_monthly_cell_voucher',
]) {
  expect(migration.includes(`create or replace function public.${name}`), `${name} RPC missing`);
  expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`, 'i').test(migration), `${name} service grant missing`);
}
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'monthly audit must not read Meiguanjia');

for (const operation of [
  'monthly_cell_save', 'monthly_cell_unlock_request', 'monthly_cell_unlock_decide',
]) expect(api.includes(`operation === "${operation}"`), `${operation} API route missing`);
expect(api.includes('effectiveMonthlyDisplay(') && api.includes('safeFormulaValue('), 'effective amount/formula projection missing');
expect(api.includes('confirmed_finance.adjust') && api.includes('finance_account.create'), 'finance/admin separation missing');
expect(api.includes('monthly_cell_id') && api.includes('zysyr_attach_monthly_cell_voucher'), 'direct cell voucher supplement missing');
expect(!api.includes('method: "PATCH", headers: { Prefer: "return=minimal" },\n        body: JSON.stringify({ display_value: value, numeric_value: numeric })'), 'immutable source cell PATCH returned');

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes('保存金额修改') && page.includes('申请修改锁账月份'), 'monthly revision controls missing');
expect(page.includes('data-unlock-decision') && page.includes('批准一次修改'), 'administrator decision UI missing');
expect(page.includes('amount_history') && page.includes('金额修改记录（永久留痕）'), 'shareholder audit history UI missing');
expect(page.includes('monthly_cell_id:target.id'), 'cell-specific voucher upload payload missing');
expect(page.includes('Object.keys(state.monthlyDirty'), 'dirty-only monthly save missing');
expect(page.includes("cell.cell_kind==='input'") && page.includes('isAggregate') && page.includes('isTotal'), 'derived cells must not render as editable');
expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain default home');
expect(!/data-view="revenue"|mgj_service_records/.test(page), 'turnover UI or Meiguanjia source returned');

console.log('ZYSYR monthly finance audit closure static tests passed');
