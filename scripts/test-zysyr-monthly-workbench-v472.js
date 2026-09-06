#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260905073551_zysyr_monthly_evidence_workbench.sql'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
function expect(value, message) { if (!value) throw new Error(message); }

for (const marker of [
  '填写 / 修改金额', '上传本月资料', 'monthly-material-form', '月报金额工作台',
  '上传并定位凭证', '本项目凭证要求', '必须有凭证', '原始报表即可', '无需凭证',
  '查看组成明细（', '关闭的是“强制上传图片凭证”',
]) expect(page.includes(marker), `monthly workbench UI missing: ${marker}`);

expect(page.includes("record_type:'report',record_id:report.id,monthly_cell_id:target.id")
  && api.includes('p_source_cell_id: monthlyCellId'), 'voucher upload must bind to the selected monthly cell');
expect(page.includes("report_type:type,report_date:date,month:$('month').value")
  && page.includes('日报日期必须属于当前月份'), 'monthly materials must remain scoped to the active store and month');
expect(page.includes("cell.onclick=function(){openMonthlyVoucher(cell.dataset.traceCell)}")
  && page.includes("typeof value==='number'"), 'only numeric report amounts should open the monthly workbench');
expect(page.includes("state.user.role!=='finance'||!!report.historical||data.evidence_policy==='none'"),
  'no-evidence policy must remove the forced voucher upload action');

for (const policy of ['voucher_required', 'source_report', 'none']) {
  expect(api.includes(`"${policy}"`) && migration.includes(`'${policy}'`), `evidence policy missing: ${policy}`);
}
expect(api.includes('defaultMonthlyEvidencePolicy') && api.includes('monthlyEvidencePolicyMap')
  && api.includes('monthly_evidence_rule_save'), 'monthly evidence policy API flow missing');
expect(api.includes('uploadedVoucherCount > 0 ? "matched"'),
  'newly uploaded cell voucher must immediately mark the amount as matched');
expect(api.includes('evidencePolicy === "voucher_required" && !evidence.length')
  && api.includes('evidencePolicy === "source_report" && !sources.length'),
  'required voucher and source-report anomalies must be evaluated separately');

expect(migration.includes('create table public.zysyr_monthly_evidence_rules')
  && migration.includes('unique (company_id, store_id, template_code, cell_address)'),
  'evidence rules must be isolated by company, store, template and cell');
expect(migration.includes("account_has_company_capability(")
  && migration.includes("'finance_account.create'"), 'only company administrators may change evidence rules');
expect(migration.includes("'monthly_evidence_rule'") && migration.includes("'save_evidence_policy'")
  && migration.includes("'financial'"), 'evidence policy changes must write permanent financial audit events');
expect(migration.includes('enable row level security') && migration.includes('force row level security')
  && migration.includes('dashboard.store.read'), 'evidence rules must enforce store-scoped RLS');
expect(/revoke execute on function public\.zysyr_save_monthly_evidence_rule[\s\S]*?from public, anon, authenticated/.test(migration)
  && /grant execute on function public\.zysyr_save_monthly_evidence_rule[\s\S]*?to service_role/.test(migration),
  'evidence rule RPC must not be browser-executable');

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'inline script missing');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes(`data-version="${releaseVersion}"`)
  && page.includes(`operations-auth-bridge.js?v=${releaseVersion}`)
  && page.includes(`operations-voucher-view.js?v=${releaseVersion}`), 'release cache markers missing');
console.log('ZYSYR_MONTHLY_WORKBENCH_V472_STATIC_OK');
