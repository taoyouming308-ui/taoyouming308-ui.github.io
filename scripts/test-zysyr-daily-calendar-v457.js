#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260828030414_zysyr_daily_calendar_editor_and_attachments.sql'), 'utf8');
function expect(value, message) { if (!value) throw new Error(message); }

for (const marker of ['待填写', '缺少原始日报', '数据异常', '已锁定', '营业收入 ¥']) {
  expect(page.includes(marker), `calendar status missing: ${marker}`);
}
for (const id of ['daily-detail-grid', 'daily-detail-upload', 'daily-detail-attachments', 'daily-detail-history', 'daily-detail-reason', 'daily-detail-unlock']) {
  expect(page.includes(`id="${id}"`), `daily detail control missing: ${id}`);
}
expect(page.includes('上传不会读取或覆盖电子表格'), 'manual-entry boundary copy missing');
expect(page.includes("api('daily_sheet_save'") && page.includes("api('daily_sheet_confirm'"), 'daily detail save/confirm path missing');
expect(page.includes("api('daily_sheet_attachment_upload'"), 'daily source upload path missing');

for (const marker of [
  'create table public.zysyr_daily_sheet_attachments',
  'enable row level security',
  'force row level security',
  'zysyr_daily_sheet_attachments_append_only',
  'zysyr_register_daily_sheet_attachment',
  'zysyr_daily_sheet_changes_require_unlocked',
  'zysyr_daily_sheet_consume_unlock',
  'zysyr_monthly_cell_unlock_requests',
  'alter column source_sha256 drop not null',
]) expect(migration.includes(marker), `migration safeguard missing: ${marker}`);
expect(/revoke execute on function public\.zysyr_register_daily_sheet_attachment[\s\S]*?from public, anon, authenticated, service_role/.test(migration), 'daily attachment RPC browser revoke missing');
expect(/grant execute on function public\.zysyr_register_daily_sheet_attachment[\s\S]*?to service_role/.test(migration), 'daily attachment RPC service grant missing');
expect(migration.includes("'application/pdf'") && migration.includes('spreadsheetml.sheet'), 'daily attachment formats missing');
expect(migration.includes("ocr_status, audit_status, document_type") && migration.includes("'reviewed'"), 'AI-free attachment registration missing');

expect(api.includes('async function uploadDailySheetAttachment'), 'daily attachment API missing');
expect(api.includes('operation === "daily_sheet_attachment_upload"'), 'daily attachment route missing');
expect(api.includes('formal_cells_unchanged: true') && api.includes('ai_recognition_enabled: false'), 'attachment/formal-value boundary missing');
expect(api.includes('zysyr_daily_sheet_cell_changes?select=') && api.includes('changed_by_name'), 'daily change history missing');
expect(api.includes('zysyr_period_locks?select=') && api.includes('missing_original'), 'lock or completeness state missing');
expect(api.includes('daily_unlock_approved') && page.includes("api('monthly_cell_unlock_request'"), 'locked daily approval path missing');

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'inline script missing');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes('data-version="457"') && page.includes('operations-auth-bridge.js?v=457'), 'v457 cache markers missing');
console.log('ZYSYR_DAILY_CALENDAR_V457_STATIC_OK');
