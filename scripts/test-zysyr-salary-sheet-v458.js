#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828033307_zysyr_salary_sheet_editor_and_attachments.sql'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
function expect(value, message) { if (!value) throw new Error(message); }

const fields = [
  '职位', '姓名', '基本工资', '工龄工资', '岗位工资', '饭补', '业绩提成', '外卖办卡提成',
  '加班费／活动津贴', '补发补扣', '应发', '成本', '迟到／早退', '拍摄', '请假', '成长',
  '自购', '社保（员工缴）', '应扣', '实发', '备注／签字',
];
for (const label of fields) expect(page.includes(`label:'${label}'`), `original salary field missing: ${label}`);
expect(page.includes('salary-paper') && page.includes('colspan="21"'), '21-column paper layout missing');
expect(page.includes('应发 = 基本工资 + 工龄工资 + 岗位工资')
  && page.includes('应扣 = 成本 + 迟到／早退 + 拍摄 + 请假 + 成长 + 自购 + 社保（员工缴）')
  && page.includes('实发 = 应发 - 应扣'), 'approved salary formulas missing from UI');
expect(page.includes('不使用 AI 识别入账') && page.includes('manual_entry_only:true')
  && page.includes('ai_recognition_enabled:false'), 'manual-only salary boundary missing');
for (const marker of ['salary-original-upload', 'salary-report-history', 'salary-unlock-panel', 'openSalarySheetRowTrace']) {
  expect(page.includes(marker), `salary UI control missing: ${marker}`);
}
for (const operation of [
  'salary_sheet_read', 'salary_sheet_create', 'salary_sheet_save', 'salary_sheet_attachment_upload',
  'salary_sheet_confirm_lock', 'salary_sheet_unlock_request', 'salary_sheet_unlock_decide',
  'salary_sheet_revision_begin',
]) expect(api.includes(`operation === "${operation}"`), `salary API route missing: ${operation}`);
expect(api.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  && api.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'salary DOCX/XLSX upload support missing');
expect(api.includes('source_salary_sheet_row_id') && api.includes('salary_sheet_row'), 'salary row trace API missing');
expect(!/salarySheetData[\s\S]*?MOONSHOT_API_KEY/.test(api), 'salary sheet must not invoke OCR/AI');

for (const table of [
  'zysyr_salary_sheet_drafts', 'zysyr_salary_sheet_rows', 'zysyr_salary_sheet_changes',
  'zysyr_salary_sheet_attachments', 'zysyr_salary_sheet_unlock_requests',
]) {
  expect(migration.includes(`create table public.${table}`), `${table} missing`);
  expect(migration.includes(`alter table public.${table} enable row level security`)
    && migration.includes(`alter table public.${table} force row level security`), `${table} RLS missing`);
}
expect(migration.includes('gross_pay numeric(14,2) generated always as')
  && migration.includes('total_deductions numeric(14,2) generated always as')
  && migration.includes('net_pay numeric(14,2) generated always as'), 'database-generated salary formulas missing');
expect(migration.includes('zysyr_salary_sheet_changes_append_only')
  && migration.includes('zysyr_salary_sheet_attachments_append_only'), 'salary audit/evidence immutability missing');
expect(migration.includes('SALARY_ORIGINAL_REPORT_REQUIRED')
  && migration.includes('SALARY_PAID_REVERSAL_REQUIRED')
  && migration.includes('SALARY_UNLOCK_SELF_APPROVAL_FORBIDDEN'), 'salary lock/revision safeguards missing');
expect(migration.includes("'salary_sheet_row'") && migration.includes("'derived_from'")
  && migration.includes("'source_document'"), 'salary evidence graph missing');
expect(migration.includes("'image/jpeg','image/png','application/pdf'")
  && migration.includes('wordprocessingml.document'), 'salary original formats missing');
for (const rpc of [
  'zysyr_create_salary_sheet', 'zysyr_save_salary_sheet', 'zysyr_register_salary_sheet_attachment',
  'zysyr_confirm_and_lock_salary_sheet', 'zysyr_request_salary_sheet_unlock',
  'zysyr_decide_salary_sheet_unlock', 'zysyr_begin_salary_sheet_revision',
]) {
  expect(migration.includes(`create or replace function public.${rpc}`), `${rpc} missing`);
  expect(new RegExp(`revoke execute on function public\\.${rpc}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i').test(migration), `${rpc} browser revoke missing`);
  expect(new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*?to service_role`, 'i').test(migration), `${rpc} service grant missing`);
}

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'inline script missing');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes(`data-version="${releaseVersion}"`)
  && page.includes(`operations-auth-bridge.js?v=${releaseVersion}`), 'v458 cache markers missing');
console.log('ZYSYR_SALARY_SHEET_V458_STATIC_OK');
