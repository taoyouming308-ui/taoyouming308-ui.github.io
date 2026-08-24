#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm'),root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260822033709_zysyr_sprint7_import_reconciliation.sql'),'utf8');
const runtime=fs.readFileSync(path.join(root,'scripts/test-zysyr-sprint7-runtime.sql'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'operations.html'),'utf8');
function expect(value,message){if(!value)throw new Error(message)}
for(const table of ['zysyr_import_batches','zysyr_import_rows','zysyr_import_conflicts','zysyr_reconciliation_reports','zysyr_reconciliation_lines']){
  expect(migration.includes(`create table public.${table}`),`${table} missing`);expect(migration.includes(`alter table public.${table} enable row level security`),`${table} RLS missing`);expect(migration.includes(`alter table public.${table} force row level security`),`${table} forced RLS missing`)}
for(const name of ['zysyr_create_photo_import_batch','zysyr_attach_import_report','zysyr_finalize_daily_import']){
  expect(migration.includes(`function public.${name}`),`${name} missing`);expect(new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*?from public,anon,authenticated,service_role`,'i').test(migration),`${name} browser revoke missing`);expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`,'i').test(migration),`${name} service grant missing`)}
expect(migration.includes('existing_daily_report')&&migration.includes('payload_sha256')&&migration.includes('IMPORT_RECONCILIATION_MISMATCH'),'conflict/hash/reconciliation controls missing');
expect(migration.includes("'income_record'")&&migration.includes("'source_document'"),'income-to-voucher trace missing');
for(const operation of ['import_center','photo_daily_import'])expect(api.includes(`operation === "${operation}"`),`${operation} API route missing`);
expect(api.includes('zysyr-date.mjs')&&api.includes('parseMonth(payload.month)'),'shared month parser missing');
expect(api.includes('source_kind: "approved_daily_photo_review_grid"')&&api.includes('旧版手工文本导入已停用')&&api.includes('meiguanjia_used: false'),'review-grid photo source boundary missing');
expect(page.includes('data-view="monthly" class="active"'),'original monthly home changed');expect(page.includes('data-view="import"')&&page.includes('id="view-import"'),'photo import UI missing');expect(page.includes('原图永久保留')&&page.includes('任一差异都会禁止入账'),'review-grid safety copy missing');
const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];expect(scripts.length===1,'inline script missing');new vm.Script(scripts[0][1],{filename:'operations.html'});
expect(runtime.includes('DUPLICATE_DAILY_CONFLICT_MISSING')&&runtime.includes('IMPORTED_INCOME_VOUCHER_TRACE_MISSING')&&runtime.includes('IMPORT_CROSS_STORE_WAS_NOT_BLOCKED'),'critical runtime cases missing');
console.log('ZYSYR_SPRINT7_IMPORT_RECONCILIATION_STATIC_OK');
