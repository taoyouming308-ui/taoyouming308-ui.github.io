const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260820114519_zysyr_sprint3_finance_workflows.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

for (const name of [
  'zysyr_upsert_expense_category', 'zysyr_submit_expense', 'zysyr_review_expense',
  'zysyr_record_petty_cash', 'zysyr_confirm_expense_payment',
  'zysyr_reverse_finance_record', 'zysyr_generate_monthly_report',
  'zysyr_transition_monthly_report',
]) {
  expect(migration.includes(`create or replace function public.${name}`), `${name} RPC missing`);
  expect(new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*?from public, anon, authenticated`, 'i').test(migration), `${name} browser revoke missing`);
  expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`, 'i').test(migration), `${name} service role grant missing`);
}

expect(migration.includes('assert_approved_vouchers') && migration.includes('APPROVED_VOUCHER_REQUIRED'), 'approved-voucher requirement missing');
expect(migration.includes("'evidenced_by'") && migration.includes("'derived_from'"), 'voucher/monthly trace edges missing');
expect(migration.includes("'SUM(EXPENSE_*,PETTY_CASH_OUT)'") && migration.includes("component.metric_code = 'PETTY_CASH_OUT'"), 'original-report petty-cash expense rule missing');
expect(migration.includes("total.metric_code = 'NET_PROFIT'") && migration.includes("component.metric_code in ('TOTAL_INCOME', 'TOTAL_EXPENSE')"), 'monthly formula trace chain missing');
expect(migration.includes('zysyr_period_locks') && migration.includes('zysyr_period_lock_events'), 'period lock audit missing');
expect(migration.includes("coalesce(v_before->>'status', v_before->>'workflow_status')"), 'expense reversal source status missing');
expect(migration.includes('v_period_lock_id'), 'monthly unlock must not reuse input report id');

for (const operation of [
  'finance_workbench', 'expense_category_save', 'expense_submit', 'expense_review',
  'petty_cash_record', 'expense_payment_confirm', 'finance_record_reverse',
  'monthly_generate', 'monthly_transition',
]) expect(api.includes(`operation === "${operation}"`), `${operation} API route missing`);

expect(api.includes('formal_source: "finance_submitted_expense"'), 'formal expense source marker missing');
expect(api.includes('meiguanjia_used: false'), 'Meiguanjia exclusion marker missing');
expect(!/rest\("zysyr_expense_records"[\s\S]{0,300}method:\s*"POST"/.test(api), 'legacy direct expense insert remains');
expect(api.includes('历史支出不能无凭证批量写入'), 'unsafe historical expense import is not retired');
expect(api.includes('hasAuthCapability(session, "expense.create_submit")'), 'finance capability boundary missing');

expect(page.includes('data-view="monthly" class="active"'), 'original monthly report is no longer the default home page');
expect(page.includes('data-view="finance-workbench" class="finance-workbench-entry hidden"'), 'finance workbench navigation missing');
expect(page.includes('id="expense-form"') && page.includes('id="petty-cash-form"') && page.includes('id="payment-form"'), 'finance forms missing');
expect(page.includes('id="monthly-close-form"'), 'monthly close form missing');
expect(page.includes('已审核支出凭证（可多选）') && page.includes('已审核付款凭证（可多选）'), 'voucher selection UI missing');
expect(!/data-view="revenue"|mgj_service_records/.test(page), 'turnover UI or Meiguanjia source returned');

console.log('ZYSYR_SPRINT3_WORKFLOWS_STATIC_OK');
