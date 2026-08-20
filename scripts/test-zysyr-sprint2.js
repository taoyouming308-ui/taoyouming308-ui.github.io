#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260820102856_zysyr_sprint2_voucher_center.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}
function has(fragment) {
  return migration.includes(fragment);
}

expect(has('alter column record_id drop not null'), 'first-class unassigned voucher support missing');
expect(has("ocr_status text not null default 'pending'") && has("audit_status text not null default 'pending'"), 'voucher OCR/audit status missing');
expect(has('zysyr_voucher_attachments_review_state_check'), 'voucher review consistency constraint missing');
expect(has('zysyr_voucher_attachments_review_queue_idx'), 'voucher review queue index missing');
expect(has('create table public.zysyr_voucher_ocr_tasks'), 'provider-neutral OCR task table missing');
expect(has('raw_result jsonb') && has('candidate_fields jsonb') && has('field_confidences jsonb'), 'OCR raw/candidate/confidence fields missing');
expect(has('create table public.zysyr_voucher_reviews'), 'immutable human-review table missing');
expect(has('candidate_fields jsonb') && has('corrected_fields jsonb') && has('review_version integer'), 'review before/after version data missing');
expect(has('zysyr_voucher_reviews_immutable') && has('VOUCHER_REVIEW_HISTORY_IMMUTABLE'), 'review immutability trigger missing');
expect(has("('voucher.review', '人工审核凭证与OCR候选字段', 'high')") && has("role.code = 'finance'"), 'finance voucher-review capability missing');
expect(has('create or replace function zysyr_private.account_is_finance_in_scope'), 'finance role/scope guard missing');
expect(has('create or replace function public.zysyr_register_voucher'), 'audited voucher registration RPC missing');
expect(has('pg_advisory_xact_lock') && has('VOUCHER_DUPLICATE_FILE'), 'concurrent duplicate-file protection missing');
expect(has('create or replace function public.zysyr_review_voucher'), 'voucher review RPC missing');
expect(has('for update;') && has('p_corrected_fields') && has('p_field_confidences'), 'review locking or correction provenance missing');
expect(has("'voucher_attachment', p_voucher_id, 'review'") && has("p_actor_user_id, 'api'"), 'atomic voucher audit event missing');
expect(has('create or replace function public.zysyr_record_voucher_ocr_result'), 'OCR provider callback RPC missing');
expect(has("current_setting('request.jwt.claim.role', true) <> 'service_role'"), 'OCR callback must require service role');
expect(has("'OCR候选字段已生成，等待财务人工复核。'"), 'OCR candidate-only boundary missing');
expect(has("business_type = 'report_upload'") && has('REPORT_NOT_FOUND'), 'validated report linkage missing');
expect(has('p_report_ids uuid[]') && has('unnest(v_report_ids)') && has("'report_ids', to_jsonb(v_report_ids)"), 'one voucher must support multiple report links');
['zysyr_voucher_attachments', 'zysyr_voucher_links', 'zysyr_voucher_ocr_tasks', 'zysyr_voucher_reviews'].forEach((table) => {
  expect(has(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(has(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
  expect(has(`revoke all on table public.${table} from public, anon, authenticated, service_role`), `${table} default grants not revoked`);
});
const voucherExecuteGrants = migration.match(/grant execute on function public\.zysyr_(?:register|review)_voucher\([\s\S]*?\) to [^;]+;/gi) || [];
expect(voucherExecuteGrants.length === 2 && voucherExecuteGrants.every((grant) => /to service_role;/i.test(grant)), 'voucher write RPC must be service-role-only');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'voucher center must not use Meiguanjia');

expect(api.includes('async function voucherCenter(') && api.includes('operation === "voucher_center"'), 'voucher-center query API missing');
expect(api.includes('async function reviewVoucher(') && api.includes('operation === "voucher_review"'), 'voucher-review API missing');
expect(api.includes('rpc/zysyr_register_voucher') && api.includes('rpc/zysyr_review_voucher'), 'voucher RPC wiring missing');
expect(api.includes('canUploadVouchers') && api.includes('canReviewVouchers'), 'finance voucher permission gates missing');
expect(api.includes('payload.report_ids') && api.includes('p_report_ids: reportIds'), 'multiple report-link API wiring missing');
expect(api.includes('zysyr_voucher_ocr_tasks?select=') && api.includes('zysyr_voucher_reviews?select='), 'OCR/review read model missing');
expect(api.includes('该文件已上传') && api.includes('相同凭证已经上传'), 'duplicate feedback missing');

const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(inlineScripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(inlineScripts[0][1], { filename: 'operations.html' });
expect(page.includes('data-view="vouchers">凭证中心</button>'), 'voucher-center navigation missing');
expect(page.includes('id="view-vouchers"') && page.includes('财务上传原始凭证'), 'voucher-center page missing');
expect(page.includes('原图是事实来源') && page.includes('OCR候选与置信度'), 'side-by-side review guidance missing');
expect(page.includes("api('voucher_center'") && page.includes("api('voucher_review'"), 'voucher-center UI API wiring missing');
expect(page.includes('data-voucher-report') && page.includes('report_ids:Array.from'), 'multiple report-link review control missing');
expect(page.includes("record_type:'unassigned'") && page.includes('相同文件哈希会被阻止'), 'independent upload or duplicate boundary missing');
expect(page.includes('Sprint 3 再关联正式财务记录'), 'Sprint boundary disclosure missing');
expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain default home');
expect(!/data-view="revenue"|mgj_service_records/.test(page), 'voucher work must not restore Meiguanjia turnover UI');

console.log('ZYSYR Sprint 2 voucher-center tests passed');
