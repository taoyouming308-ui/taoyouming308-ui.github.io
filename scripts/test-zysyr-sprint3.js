#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260820112615_zysyr_sprint3_finance_foundation.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}
function has(fragment) {
  return migration.includes(fragment);
}

[
  'zysyr_expense_categories', 'zysyr_daily_reports', 'zysyr_daily_report_lines',
  'zysyr_income_records', 'zysyr_petty_cash_records', 'zysyr_payment_records',
  'zysyr_metric_definitions', 'zysyr_monthly_reports', 'zysyr_monthly_report_lines',
].forEach((table) => expect(has(`public.${table}`), `${table} missing`));
expect(has('alter table public.zysyr_expense_records') && has('expense_category_id uuid'), 'legacy expense table must be extended, not duplicated');
expect(has("numeric(14,2)") && !/\b(?:real|double precision)\b/i.test(migration), 'financial amounts must use exact numeric types');
expect(has('zysyr_report_cells_company_store_id_key') && has('source_report_cell_id uuid'), 'exact same-store workbook-cell provenance missing');
expect(has("extract(isodow from v_source.report_date) <> 1") && has("'monday_rule'"), 'Monday business-day default missing');
expect(has('create or replace function zysyr_private.assert_finance_scope'), 'finance role/scope assertion missing');
expect(has('account_is_finance_in_scope') && has('account_has_capability'), 'finance role and capability must both be checked');
expect(has('create or replace function public.zysyr_save_daily_report'), 'formal daily-report submission RPC missing');
expect(has('create or replace function public.zysyr_review_daily_report'), 'formal daily-report review RPC missing');
expect(has('insert into public.zysyr_income_records') && has("line.line_type = 'income'"), 'approved daily income materialization missing');
expect(has('create or replace function public.zysyr_link_finance_voucher'), 'formal record voucher-link RPC missing');
expect(has("voucher.audit_status = 'approved'") && has('FINANCE_BUSINESS_RECORD_NOT_FOUND'), 'voucher/business validation missing');
expect(has("sensitivity in ('normal', 'personal', 'payroll', 'financial')"), 'formal financial audit classification compatibility missing');
expect(has('zysyr_daily_report_lines_immutable') && has('zysyr_monthly_report_lines_immutable'), 'report line immutability missing');
expect(has('zysyr_private.period_is_locked') && has('FINANCE_PERIOD_LOCKED'), 'period-lock enforcement missing');
expect(has('zysyr_workflow_events') && has('before_json') && has('after_json'), 'workflow and before/after audit missing');
[
  'zysyr_expense_categories', 'zysyr_daily_reports', 'zysyr_daily_report_lines',
  'zysyr_income_records', 'zysyr_petty_cash_records', 'zysyr_payment_records',
  'zysyr_metric_definitions', 'zysyr_monthly_reports', 'zysyr_monthly_report_lines',
].forEach((table) => {
  expect(has(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(has(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
});
const rpcGrants = migration.match(/grant execute on function public\.zysyr_(?:save|review)_daily_report|grant execute on function public\.zysyr_link_finance_voucher/g) || [];
expect(rpcGrants.length === 3, 'three service-only finance RPC grants expected');
expect(!/grant execute on function public\.zysyr_(?:save|review)_daily_report\([\s\S]*?\) to authenticated/i.test(migration), 'browser daily-report write grant found');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'Sprint 3 formal finance must not use Meiguanjia');

expect(api.includes('async function saveDailyReport(') && api.includes('operation === "daily_report_save"'), 'daily-report API missing');
expect(api.includes('async function reviewDailyReport(') && api.includes('operation === "daily_report_review"'), 'daily-review API missing');
expect(api.includes('async function linkFinanceVoucher(') && api.includes('operation === "finance_voucher_link"'), 'formal voucher-link API missing');
expect(api.includes('formal_source: "finance_uploaded_daily_report"') && api.includes('meiguanjia_used: false'), 'finance-only source boundary missing');
expect(api.includes('operations_role, 40) !== "finance"'), 'API finance role gate missing');
expect(api.includes('每个日报数字都必须选择原表单元格'), 'API exact-cell requirement missing');

const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(inlineScripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(inlineScripts[0][1], { filename: 'operations.html' });
expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain default home');
expect(!/data-view="revenue"|mgj_service_records/.test(page), 'Sprint 3 must not restore turnover UI or Meiguanjia');

console.log('ZYSYR Sprint 3 finance-foundation tests passed');
