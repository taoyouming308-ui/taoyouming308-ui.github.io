#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260822015949_zysyr_sprint4_payroll_traceability.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

const tables = [
  'zysyr_attendance_records', 'zysyr_check_records', 'zysyr_penalty_reward_records',
  'zysyr_performance_records', 'zysyr_commission_rules',
  'zysyr_salaries', 'zysyr_salary_details',
];
for (const table of tables) {
  expect(migration.includes(`create table public.${table}`), `${table} missing`);
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
}
expect(/numeric\(14,2\)/.test(migration) && !/\b(?:real|double precision)\b/i.test(migration), 'payroll money must use exact numeric');
expect(migration.includes('zysyr_salary_details_immutable'), 'salary detail immutability missing');
expect(migration.includes('salary.write_approve') && migration.includes('assert_finance_scope'), 'finance role and salary capability gate missing');
expect(migration.includes('FINANCE_PERIOD_LOCKED') && migration.includes('MONTHLY_HAS_DRAFT_SALARY'), 'period/draft salary lock gate missing');
expect(migration.includes('zysyr_private.assert_approved_vouchers') && migration.includes("'payment_proof'"), 'approved payroll voucher gate missing');
expect(migration.includes('PERFORMANCE_HAIRSTYLIST_ONLY'), 'hairstylist-only performance rule missing');
expect(migration.includes('COMMISSION_RULE_REQUIRED') && migration.includes('COMMISSION_RULE_AMBIGUOUS'), 'no-guess commission rule enforcement missing');
expect(/final_salary\s*=\s*round\(base_salary\s*\+\s*v_commission\s*\+\s*v_bonus\s*-\s*v_deduction[\s\S]{0,100}-\s*social_security\s*\+\s*other_adjustment/.test(migration), 'salary formula missing');
expect(migration.includes("line_type in ('base', 'commission', 'bonus', 'penalty', 'social_security', 'other')"), 'decomposed salary line types missing');
expect(migration.includes("status in ('approved', 'paid')") && migration.includes('SALARY_CONFIRMED_REVERSE_REQUIRED'), 'confirmed payroll must be reversed, not overwritten');
expect(migration.includes('zysyr_private.is_self_employee(employee_id)'), 'employee self-only RLS missing');
expect(migration.includes("'attendance_record'") && migration.includes("'penalty_reward'") && migration.includes("'commission_rule'"), 'attendance/reward/rule trace edges missing');
expect(migration.includes('CHECK_SOURCE_NOT_FOUND') && migration.includes("'check_record'"), 'formal check to penalty trace missing');
expect(migration.includes('SALARY_BASE_SOURCE_CELL_MISMATCH') && migration.includes('SALARY_SOCIAL_SOURCE_CELL_MISMATCH')
  && migration.includes('SALARY_OTHER_SOURCE_CELL_MISMATCH'), 'salary exact-cell amount gates missing');
expect(migration.includes("'base', 'report_cell'") && migration.includes("'social_security', 'report_cell'")
  && migration.includes("'other', 'report_cell'"), 'manual salary components must use report cells');
expect(migration.includes("'payment_record'") && migration.includes("'payment_proof'") && migration.includes('link_finance_vouchers'), 'payroll voucher/payment trace missing');
expect(migration.includes("'LABOR_COST', '人工成本'") && migration.includes("'SUM(EXPENSE_*,PETTY_CASH_OUT,LABOR_COST)'"), 'approved payroll monthly labor cost missing');
expect(migration.includes("line.metric_code = 'LABOR_COST'") && migration.includes("salary_node.entity_type = 'salary'"), 'monthly labor-to-salary trace missing');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'payroll must not use Meiguanjia');

const rpcNames = [
  'zysyr_record_attendance', 'zysyr_record_check', 'zysyr_record_penalty_reward',
  'zysyr_record_performance', 'zysyr_upsert_commission_rule',
  'zysyr_generate_salary', 'zysyr_transition_salary',
  'zysyr_reverse_payroll_record',
];
for (const name of rpcNames) {
  expect(migration.includes(`create or replace function public.${name}`), `${name} RPC missing`);
  expect(new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*?from public, anon, authenticated`, 'i').test(migration), `${name} browser revoke missing`);
  expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`, 'i').test(migration), `${name} service-only grant missing`);
}

for (const operation of [
  'payroll_center', 'attendance_record', 'check_record', 'penalty_reward_record',
  'performance_record', 'commission_rule_save', 'salary_generate',
  'salary_transition', 'payroll_record_reverse',
]) expect(api.includes(`operation === "${operation}"`), `${operation} API route missing`);
expect(api.includes('auth_employee_id') && api.includes('personal_scope'), 'employee personal payroll scope missing');
expect(api.includes('员工账号只能查看本人的工资、考勤、奖罚和业绩'), 'employee route isolation missing');
expect(api.includes('hasAuthCapability(session, "salary.write_approve")'), 'salary write capability check missing');
expect(api.includes('operations_role, 40) !== "finance"'), 'finance-only payroll write gate missing');

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain default home');
expect(page.includes('data-view="payroll"') && page.includes('id="view-payroll"'), 'payroll center UI missing');
for (const label of ['姓名', '底薪', '提成', '饭补/奖励', '小计', '成长/迟到/扣款', '社保', '其他', '合计']) {
  expect(page.includes(`'${label}'`) || page.includes(`>${label}<`), `original salary column ${label} missing`);
}
expect(page.includes('data-payroll-trace') && page.includes('openPayrollTrace'), 'clickable salary component trace missing');
expect(page.includes('实发 = 底薪 + 提成 + 奖励 - 扣款 - 社保 + 其他调整'), 'salary formula display missing');
expect(page.includes('<option value="salary">工资表（每月）</option>'), 'monthly salary upload type missing');
expect(page.includes('员工视角 · 仅本人'), 'employee self-view label missing');
expect(page.includes('id="check-form"') && page.includes('形象/检查记录'), 'formal check UI missing');
expect(page.includes('id="salary-base-cell"') && page.includes('id="salary-social-cell"')
  && page.includes('id="salary-other-cell"'), 'salary exact-cell selectors missing');
expect(!/data-view="revenue"|mgj_service_records/.test(page), 'turnover UI or Meiguanjia source returned');

console.log('ZYSYR_SPRINT4_PAYROLL_STATIC_OK');
