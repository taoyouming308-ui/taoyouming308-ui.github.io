#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const deno = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/deno.json'), 'utf8');
const foundation = fs.readFileSync(path.join(root, 'supabase/migrations/20260810022101_zysyr_operations_foundation.sql'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'supabase/migrations/20260813094949_zysyr_finance_report_uploads.sql'), 'utf8');
const traceability = fs.readFileSync(path.join(root, 'supabase/migrations/20260813103623_zysyr_report_cell_traceability.sql'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();

function expect(value, message) {
  if (!value) throw new Error(message);
}

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(inlineScripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(inlineScripts[0][1], { filename: 'operations.html' });

expect(new RegExp(`<html[^>]+data-version="${releaseVersion}"`).test(html), 'operations version must match current release');
expect(html.includes('原表月报') && html.includes('自由手艺人') && html.includes('月盈亏统计'), 'original monthly report home missing');
expect(html.includes('美发收入') && html.includes('普通美发产品') && html.includes('产品成本') && html.includes('备用金'), 'original monthly report labels missing');
expect(html.includes('底薪') && html.includes('提成') && html.includes('社保') && html.includes('成本／成长／迟到/拍摄'), 'original payroll columns missing');
expect(html.includes('财务上传') && html.includes('日报表（每日）') && html.includes('业绩报表（每日）') && html.includes('月度盈亏表（每月）'), 'finance report upload entry missing');
expect(html.includes('本报表消费凭证（可多选）') && html.includes("record_type:'report'"), 'report voucher upload flow missing');
expect(html.includes("api('report_upload'") && html.includes("openPrivate('report_url'") && html.includes("openPrivate('voucher_url'"), 'protected report and evidence flows missing');
expect(html.includes("api('cell_trace'") && html.includes("api('cell_trace_save'") && html.includes("api('report_cells'"), 'cell-level trace UI flow missing');
expect(html.includes('怎么算出来的') && html.includes('来自哪天、哪一行、谁上传') && html.includes('对应凭证'), 'shareholder trace drawer copy missing');
expect(html.includes('trace-mismatch') && html.includes('trace-missing_evidence') && html.includes('trace-unlinked'), 'trace exception highlighting missing');
expect(html.includes('股东视角 · 只读') && html.includes('财务视角 · 可上传'), 'shareholder and finance perspectives missing');
expect(html.includes('不连接、不读取美管加') && html.includes('数值只取自本页所示财务上传原件'), 'finance-only source boundary copy missing');
expect(!html.includes('kpi-income') && !html.includes('每日收支趋势') && !html.includes('data-view="revenue"'), 'automatic KPI, trend, or ranking UI must be removed');
expect(!html.includes('美管加已同步消费') && !html.includes('income_read_only_from_mgj'), 'old Meiguanjia synchronization copy must be removed');
expect(html.includes('无需填写邮箱') && html.includes('员工账号') && html.includes('密码'), 'username/password login copy missing');
expect(html.includes('operations-auth-bridge.js?v=' + releaseVersion), 'versioned Auth bridge missing');
expect(html.includes('sb_publishable_') && !html.includes('SUPABASE_SERVICE_ROLE_KEY'), 'frontend key boundary invalid');
expect(admin.includes('href="operations.html"'), 'admin entry to operations missing');

expect(edge.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), 'Edge Function must keep service role server-side');
expect(edge.includes('operations-auth') && edge.includes('requireSession'), 'Supabase Auth session validation missing');
expect(edge.includes('canUploadReports') && edge.includes('report.upload') && edge.includes('operations_role') && edge.includes('finance'), 'finance-only report permission missing');
expect(edge.includes('selectedStoreInfo') && edge.includes('auth_company_id') && edge.includes('auth_store_records'), 'company/store authorization binding missing');
expect(edge.includes('zysyr_report_uploads') && edge.includes('finance_uploads_only'), 'finance report source missing');
expect(edge.includes('workbookDisplay') && edge.includes('ExcelJS.Workbook') && edge.includes('model.merges'), 'Excel display projection missing');
expect(edge.includes('formulaPrecedents') && edge.includes('reportCellLabel') && edge.includes('precedent_addresses'), 'cell formula and original-position parsing missing');
expect(edge.includes('/向里/.test(storeName)') && edge.includes('["向里业绩报表", "业绩报表"]'), 'store-specific performance worksheet selection missing');
expect(edge.includes('zysyr_register_report_upload') && edge.includes('zysyr_report_cells'), 'transactional report-cell registration missing');
expect(edge.includes('cellTrace') && edge.includes('saveCellTrace') && edge.includes('zysyr_save_report_cell_trace'), 'cell trace query/save API missing');
expect(edge.includes('sha256Bytes') && edge.includes('original_private: true'), 'report digest or private-original marker missing');
expect(edge.includes('REPORT_BUCKET') && edge.includes('/storage/v1/object/sign/'), 'private report signed-link flow missing');
expect(edge.includes('recordType === "report"') && edge.includes('rpc/zysyr_register_voucher'), 'report voucher association missing');
expect(edge.includes('p_sha256: digest') && !edge.includes('sha256: await sha256Bytes(bytes), version: 1'), 'voucher digest or immutable version flow invalid');
expect(edge.includes('Boolean(cleanText(session.auth_account_id, 40))') && !edge.includes('["shareholder", "finance", "store_manager"].includes'), 'legacy expense role fallback must remain disabled');
expect(edge.includes('async function submitExpense(') && edge.includes('p_company_id: cleanText(store.company_id, 40)') && edge.includes('p_store_id: cleanText(store.id, 40)'), 'formal expense RPC must bind company/store UUIDs');
expect(edge.includes('rpc/zysyr_submit_expense') && !/rest\("zysyr_expense_records"[\s\S]{0,300}method:\s*"POST"/.test(edge), 'expense writes must use the audited database RPC instead of direct table writes');
const expensePermissionSource = edge.match(/function canWriteExpense\(session: JsonRecord\): boolean \{[\s\S]*?\n\}/);
expect(expensePermissionSource, 'expense permission function missing');
const permissionContext = {
  cleanText(value, max = 500) { return String(value ?? '').trim().slice(0, max); },
};
vm.createContext(permissionContext);
vm.runInContext(expensePermissionSource[0]
  .replace('session: JsonRecord', 'session')
  .replace(': boolean', '')
  .replace(/ as unknown\[\]/g, ''), permissionContext);
expect(permissionContext.canWriteExpense({ operations_role: 'shareholder' }) === false, 'legacy shareholder expense write must be denied');
expect(permissionContext.canWriteExpense({ operations_role: 'finance', auth_capabilities: ['expense.create_submit'] }) === false, 'capability without Auth account must be denied');
expect(permissionContext.canWriteExpense({ auth_account_id: 'account-1', auth_capabilities: ['expense.create_submit'] }) === true, 'authorized Auth expense write must be allowed');
expect(permissionContext.canWriteExpense({ auth_account_id: 'account-1', auth_capabilities: ['dashboard.store.read'] }) === false, 'Auth account without expense capability must be denied');
expect(!edge.includes('mgj_service_records') && !edge.includes('income_read_only_from_mgj'), 'operations API must not read Meiguanjia');
expect(!edge.includes('SUPABASE_ANON_KEY'), 'Edge Function must not rely on a browser anon key');

const denoConfig = JSON.parse(deno);
expect(denoConfig.imports.exceljs === 'npm:exceljs@4.4.0', 'Excel parser dependency must be pinned');

['zysyr_stores', 'zysyr_operations_sessions', 'zysyr_expense_records', 'zysyr_voucher_attachments'].forEach((table) => {
  expect(foundation.includes(`alter table public.${table} enable row level security`), `${table} foundation RLS missing`);
});
expect(reports.includes('create table if not exists public.zysyr_report_uploads'), 'report upload table missing');
expect(reports.includes('company_id uuid not null') && reports.includes('store_id uuid not null'), 'report tenant keys missing');
expect(reports.includes('unique (company_id, store_id, report_type, report_date, version)'), 'append-only report versions missing');
expect(reports.includes('alter table public.zysyr_report_uploads enable row level security') && reports.includes('force row level security'), 'report RLS missing');
expect(reports.includes("has_capability(company_id, store_id, 'dashboard.store.read')"), 'report read policy must enforce store scope');
expect(reports.includes('revoke all on table public.zysyr_report_uploads from public, anon, authenticated, service_role'), 'report default grants not revoked');
expect(reports.includes("'zysyr-reports'") && reports.includes('false,') && reports.includes('file_size_limit'), 'private report bucket missing');
expect(reports.includes("('report.upload', '上传门店日报、业绩表和月度盈亏表'") && reports.includes("r.code = 'finance'"), 'finance report capability grant missing');
expect(reports.includes("record_type in ('expense', 'income', 'report')"), 'report voucher record type missing');
expect(reports.includes('zysyr_report_uploads_append_audit') && reports.includes("'finance_report', new.id, 'upload'"), 'transactional report audit trigger missing');
expect(reports.includes('zysyr_report_uploads_protect_version') && reports.includes('finance report versions are immutable'), 'immutable report-version trigger missing');

expect(traceability.includes('create table if not exists public.zysyr_report_cells'), 'report cell table missing');
expect(traceability.includes('cell_address text not null') && traceability.includes('precedent_addresses jsonb'), 'cell position or formula precedents missing');
expect(traceability.includes('create table if not exists public.zysyr_report_cell_trace_revisions'), 'trace revision table missing');
expect(traceability.includes("status in ('matched', 'mismatch', 'missing_evidence', 'unlinked')"), 'trace reconciliation statuses missing');
expect(traceability.includes('create table if not exists public.zysyr_report_cell_trace_sources') && traceability.includes('create table if not exists public.zysyr_report_cell_trace_evidence'), 'source/evidence link tables missing');
expect(traceability.includes('report cell trace history is append-only'), 'trace history immutability trigger missing');
expect(traceability.includes('create or replace function public.zysyr_register_report_upload') && traceability.includes("current_setting('request.jwt.claim.role', true)"), 'transactional service-only report registration missing');
expect(traceability.includes('create or replace function public.zysyr_save_report_cell_trace'), 'trace save RPC missing');
expect(traceability.includes("cap.code = 'report.upload'") && traceability.includes("report.report_type in ('daily', 'performance')"), 'finance scope or source report boundary missing');
expect(traceability.includes("abs(v_delta) > 0.01") && traceability.includes("when v_evidence_count = 0 then 'missing_evidence'"), '0.01 reconciliation or evidence check missing');
expect(traceability.includes("'report_cell_trace_revision'") && traceability.includes("'derived_from'") && traceability.includes("'evidenced_by'"), 'trace graph relations missing');
expect(traceability.includes("p_actor_user_id, 'api',") && !traceability.includes("p_actor_user_id, 'web',"), 'trace audit channel must satisfy the audit-event constraint');
['zysyr_report_cells', 'zysyr_report_cell_trace_revisions', 'zysyr_report_cell_trace_sources', 'zysyr_report_cell_trace_evidence'].forEach((table) => {
  expect(traceability.includes(`alter table public.${table} enable row level security`) && traceability.includes(`alter table public.${table} force row level security`), `${table} RLS missing`);
});

console.log('operations tests passed: finance-upload-only original report home with cell-level traceability');
