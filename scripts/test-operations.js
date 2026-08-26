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
const dailySheet = fs.readFileSync(path.join(root, 'supabase/migrations/20260824174500_zysyr_daily_sheet_review_gate.sql'), 'utf8');
const dailyManualOnly = fs.readFileSync(path.join(root, 'supabase/migrations/20260825161033_zysyr_daily_manual_entry_only.sql'), 'utf8');
const dailyEditable = fs.readFileSync(path.join(root, 'supabase/migrations/20260826120000_zysyr_daily_sheet_editable_upsert.sql'), 'utf8');
const docxLineage = fs.readFileSync(path.join(root, 'supabase/migrations/20260826045929_zysyr_v436_docx_and_report_lineage.sql'), 'utf8');
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
expect(html.includes('data-view="salary-report"') && html.includes('data-view="petty-cash-report"'), 'salary and petty-cash report navigation missing');
expect(html.indexOf('data-view="daily-report"') < html.indexOf('data-view="salary-report"') && html.indexOf('data-view="salary-report"') < html.indexOf('data-view="petty-cash-report"'), 'salary and petty-cash report navigation order invalid');
expect(html.includes("api('payroll_center'") && html.includes('工资报表（点击数字查看来源）') && html.includes('完整追溯'), 'read-only salary report or trace entry missing');
expect(html.includes("api('petty_cash_report'") && html.includes('日报与原表来源') && html.includes('原始凭证'), 'petty-cash report or source trace missing');
expect(html.includes('财务上传') && html.includes('日报表（每日）') && html.includes('工资表（每月）') && html.includes('月度盈亏表（每月）') && !html.includes('业绩报表（每日）'), 'finance report upload entry missing');
expect(html.includes('本报表消费凭证（可多选）') && html.includes("record_type:'report'"), 'report voucher upload flow missing');
expect(html.includes('原图对照人工电子日报') && html.includes('生成空白同版电子表格'), 'manual image-aligned daily entry missing');
expect(html.includes('不进行 AI 识别') && html.includes('获授权门店账号或财务人工逐格填写'), 'manual-only daily source boundary missing');
expect(html.includes('员工每行小计、项目每列小计、实做/总计、支付方式四组必须独立相等'), 'independent daily controls copy missing');
expect(html.includes("api('daily_sheet_create'") && html.includes("api('daily_sheet_save'") && html.includes("api('daily_sheet_confirm'"), 'daily sheet create/edit/confirm flow missing');
expect(html.includes('daily-original-image') && html.includes('data-daily-cell') && html.includes('manual-edit'), 'side-by-side original image or editable cell grid missing');
expect(html.includes('daily-zoom-in') && html.includes('daily-reviewed-all') && html.includes('control-mismatch'), 'manual transcription zoom, attestation, or mismatch marking missing');
expect(html.includes("api('report_upload'") && html.includes("openPrivate('report_url'") && html.includes("openPrivate('voucher_url'"), 'protected report and evidence flows missing');
expect(html.includes("api('cell_trace'") && html.includes("api('cell_trace_save'") && html.includes("api('report_cells'"), 'cell-level trace UI flow missing');
expect(html.includes("api('report_lineage'") && html.includes('data-report-lineage') && html.includes('被哪些月报数字采用'), 'forward/reverse report lineage UI missing');
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
expect(edge.includes('docxDisplay') && edge.includes('JSZip.loadAsync') && edge.includes('word/document.xml'), 'DOCX editable-table projection missing');
expect(edge.includes('formulaPrecedents') && edge.includes('reportCellLabel') && edge.includes('precedent_addresses'), 'cell formula and original-position parsing missing');
expect(edge.includes('/向里/.test(storeName)') && edge.includes('["向里业绩报表", "业绩报表"]'), 'store-specific performance worksheet selection missing');
expect(edge.includes('zysyr_register_report_upload') && edge.includes('zysyr_report_cells'), 'transactional report-cell registration missing');
expect(edge.includes('cellTrace') && edge.includes('saveCellTrace') && edge.includes('zysyr_save_report_cell_trace'), 'cell trace query/save API missing');
expect(edge.includes('reportLineage') && edge.includes('zysyr_salary_details') && edge.includes('monthly_targets'), 'cross-report lineage API missing');
expect(edge.includes('sha256Bytes') && edge.includes('original_private: true'), 'report digest or private-original marker missing');
expect(edge.includes('REPORT_BUCKET') && edge.includes('/storage/v1/object/sign/'), 'private report signed-link flow missing');
expect(edge.includes('recordType === "report"') && edge.includes('rpc/zysyr_register_voucher'), 'report voucher association missing');
expect(edge.includes('p_sha256: digest') && !edge.includes('sha256: await sha256Bytes(bytes), version: 1'), 'voucher digest or immutable version flow invalid');
expect(edge.includes('Boolean(cleanText(session.auth_account_id, 40))') && !edge.includes('["shareholder", "finance", "store_manager"].includes'), 'legacy expense role fallback must remain disabled');
expect(edge.includes('async function submitExpense(') && edge.includes('p_company_id: cleanText(store.company_id, 40)') && edge.includes('p_store_id: cleanText(store.id, 40)'), 'formal expense RPC must bind company/store UUIDs');
expect(edge.includes('async function pettyCashReport(') && edge.includes('can_read_petty_cash_reports'), 'read-only petty-cash report capability missing');
const pettyCashReportSource = edge.match(/async function pettyCashReport\([\s\S]*?\n\}/);
expect(pettyCashReportSource && pettyCashReportSource[0].includes('dashboard.store.read'), 'petty-cash report must require store dashboard permission');
expect(pettyCashReportSource && pettyCashReportSource[0].includes('company_id=eq.${companyId}&store_id=eq.${storeId}'), 'petty-cash report queries must bind company and store scope');
expect(pettyCashReportSource && pettyCashReportSource[0].includes('zysyr_voucher_links') && pettyCashReportSource[0].includes('zysyr_report_cells') && pettyCashReportSource[0].includes('zysyr_daily_report_lines'), 'petty-cash report source and voucher lineage missing');
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
expect(!edge.includes('Deno.env.get("MOONSHOT_API_KEY")') && !edge.includes('/chat/completions'), 'daily API must not call an AI vision provider');
expect(edge.includes('model: "manual-entry-v1"') && edge.includes('provider: "manual-entry"'), 'manual blank-template provider markers missing');
expect(edge.includes('source_method: "blank_template"') && edge.includes('ocr_numeric: null') && edge.includes('ai_recognition_enabled: false'), 'blank manual seed boundary missing');
expect(edge.includes('日报AI候选导入已停用') && edge.includes('请对照原图人工填写电子表格'), 'AI candidate import must remain disabled');
expect(edge.includes('const skipOcr = payload.skip_ocr === true') && edge.includes('manual_review_only: skipOcr'), 'manual daily originals must be able to skip OCR wake');
expect(edge.includes('payload.reviewed_all !== true'), 'server-side full-image review attestation missing');
expect(edge.includes('dailySheetSeeds') && edge.includes('staff_value') && edge.includes('payment_cashflow'), 'exact daily template cell mapping missing');
expect(edge.includes('旧版手工文本导入已停用'), 'unsafe text-only photo import must be disabled');

const denoConfig = JSON.parse(deno);
expect(denoConfig.imports.exceljs === 'npm:exceljs@4.4.0', 'Excel parser dependency must be pinned');
expect(denoConfig.imports.jszip === 'npm:jszip@3.10.1', 'DOCX ZIP parser dependency must be pinned');

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

['zysyr_daily_sheet_drafts', 'zysyr_daily_sheet_cells', 'zysyr_daily_sheet_cell_changes', 'zysyr_daily_sheet_versions'].forEach((table) => {
  expect(dailySheet.includes(`create table public.${table}`), `${table} missing`);
  expect(dailySheet.includes(`alter table public.${table} enable row level security`) && dailySheet.includes(`alter table public.${table} force row level security`), `${table} RLS missing`);
});
expect(dailySheet.includes('company_id uuid not null') && dailySheet.includes('store_id uuid not null'), 'daily sheet tenant keys missing');
expect(dailySheet.includes('zysyr_daily_sheet_changes_append_only') && dailySheet.includes('zysyr_daily_sheet_versions_append_only'), 'daily sheet immutable audit/version triggers missing');
expect(dailySheet.includes('staff_row_mismatches') && dailySheet.includes('category_mismatches') && dailySheet.includes('payment_method_total'), 'independent database controls missing');
expect(dailySheet.includes("and cell.cell_role = 'staff_value' and zysyr_private.daily_sheet_cell_value(cell) > 0"), 'formal income must use atomic stylist cells only');
expect(dailySheet.includes('DAILY_SHEET_CONTROL_MISMATCH') && dailySheet.includes("v_approved := public.zysyr_review_daily_report"), 'database-gated final confirmation missing');
expect(dailySheet.includes("'meiguanjia_used', false"), 'daily confirmation must preserve Meiguanjia boundary');
expect(dailyManualOnly.includes('when p_cell.manual_override then p_cell.corrected_numeric') && dailyManualOnly.includes('else null::numeric'), 'database totals must use manual values only');
expect(dailyManualOnly.includes('update public.zysyr_daily_sheet_drafts') && dailyManualOnly.includes('daily_sheet_validation'), 'existing draft validations must be recalculated under manual-only rules');
expect(dailyEditable.includes("v_has_value := v_item ? 'value'") && dailyEditable.includes('manual_text = v_text_after'), 'manual daily cells must support explicit clear and text persistence');
expect(dailyEditable.includes('v_section := v_cell.section_code') && dailyEditable.includes('and section_code = v_section and row_key = v_row_key'), 'daily edits must trust database cell identity and update row labels consistently');
expect(dailyEditable.includes('before_text') && dailyEditable.includes('after_text') && dailyEditable.includes('before_label') && dailyEditable.includes('after_label'), 'daily text and label audit values missing');
expect(docxLineage.includes('wordprocessingml.document') && docxLineage.includes("report.report_type in ('daily', 'performance', 'salary')"), 'DOCX constraint or salary-to-monthly source boundary missing');
expect(docxLineage.includes('daily_sheet_version_text_snapshot') && docxLineage.includes("'manual_text', cell.manual_text"), 'confirmed manual text snapshot missing');
expect(docxLineage.includes('assert_daily_entry_scope') && docxLineage.includes("'daily_report.write'"), 'authorized store daily-entry scope missing');

console.log('operations tests passed: finance-upload-only original report home with cell-level traceability');
