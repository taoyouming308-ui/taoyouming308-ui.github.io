#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260822032106_zysyr_sprint6_ocr_ai_questions.sql'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'scripts/test-zysyr-sprint6-runtime.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const ocr = fs.readFileSync(path.join(root, 'supabase/functions/voucher-ocr-worker/index.ts'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'supabase/functions/operations-ai-worker/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
function expect(value, message) { if (!value) throw new Error(message); }
for (const table of ['zysyr_ai_analysis_runs','zysyr_questions','zysyr_question_messages']) {
  expect(migration.includes(`create table public.${table}`), `${table} missing`);
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
}
for (const name of ['zysyr_claim_voucher_ocr_task','zysyr_complete_voucher_ocr_task','zysyr_retry_voucher_ocr','zysyr_request_ai_analysis','zysyr_claim_ai_analysis','zysyr_complete_ai_analysis','zysyr_create_question','zysyr_respond_question']) {
  expect(migration.includes(`function public.${name}`), `${name} missing`);
  expect(new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*?from public,anon,authenticated,service_role`, 'i').test(migration), `${name} browser revoke missing`);
  expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`, 'i').test(migration), `${name} service-only grant missing`);
}
expect(migration.includes('AI_CITATION_NOT_IN_SNAPSHOT') && migration.includes('snapshot_sha256'), 'AI evidence validation missing');
expect(migration.includes('dead_letter') && migration.includes('lease_token') && migration.includes('next_attempt_at'), 'OCR retry/lease/dead-letter missing');
expect(migration.includes('normalize_ocr_task_lease') && migration.includes('OCR_ALREADY_HUMAN_REVIEWED'), 'OCR human-review concurrency guard missing');
expect(ocr.includes('PaddlePaddle/PaddleOCR-VL-1.5') && ocr.includes('candidate_only: true') && ocr.includes('human_review_required: true'), 'PaddleOCR candidate worker boundary missing');
expect(ocr.includes('zysyr-ocr-candidates.mjs') && ocr.includes('zysyr-voucher-v2-safe-structured'), 'safe structured OCR parser missing');
expect(ocr.includes('EdgeRuntime.waitUntil') && api.includes('voucher_ocr_wake') && api.includes('wakeVoucherOcrInBackground'), 'automatic OCR queue wake missing');
expect(ai.includes('read_only: true') && ai.includes('citations_required: true') && ai.includes('evidence_snapshot'), 'read-only AI worker boundary missing');
for (const operation of ['voucher_ocr_retry','analysis_center','ai_analysis_request','question_create','question_respond']) expect(api.includes(`operation === "${operation}"`), `${operation} API route missing`);
expect(page.includes('data-view="monthly" class="active"'), 'original monthly home changed');
expect(page.includes('data-view="analysis"') && page.includes('id="view-analysis"'), 'analysis/question UI missing');
expect(page.includes('AI 结论仅供经营参考') && page.includes('不能新增、修改收入、支出、工资或库存'), 'AI non-write boundary copy missing');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]; expect(scripts.length === 1, 'operations inline script missing');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(runtime.includes('OCR_DEAD_LETTER_MISSING') && runtime.includes('OCR_REVIEW_DID_NOT_CLEAR_LEASE') && runtime.includes('AI_FALSE_CITATION_ACCEPTED') && runtime.includes('AI_CROSS_STORE_WAS_NOT_BLOCKED'), 'critical runtime cases missing');
console.log('ZYSYR_SPRINT6_OCR_AI_STATIC_OK');
