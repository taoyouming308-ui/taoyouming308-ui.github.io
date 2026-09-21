#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const assert=require('assert/strict');
const page=fs.readFileSync('operations.html','utf8');
const client=fs.readFileSync('operations-daily-recognition.js','utf8');
const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260921033000_daily_recognition_adaptive_staff_rows.sql','utf8');

new vm.Script(client,{filename:'operations-daily-recognition.js'});
for(const marker of [
  'daily-source-action upload',
  'daily-source-action-status',
  'aria-live="polite"',
  'JPG / PNG 上传成功后会自动开始 Codex 识别',
]) assert.ok(page.includes(marker),`daily source UI marker missing: ${marker}`);
for(const marker of [
  'window.ZysyrDailySourceActions',
  "begin('recognize'",
  '正在上传，请勿重复点击',
  '正在识别，请勿重复点击',
  '识别完成',
  '已按在职人数自动新增',
]) assert.ok(client.includes(marker),`duplicate-click feedback missing: ${marker}`);
assert.ok(page.includes("actions.begin('upload'"),'upload must enter shared single-flight state');
assert.ok(page.includes("actions.update('正在上传并绑定当前门店和日期"),'upload must show progress before network completion');

assert.ok(!api.includes('return names.slice(0, fallbackCount);'),'staff rows are still truncated to the paper fallback');
assert.ok(api.includes('return names.slice(0, 20);'),'adaptive row safety cap missing');
assert.ok(api.includes('rpc/zysyr_expand_daily_sheet_staff_rows'),'legacy drafts are not expanded before recognition');
assert.ok(api.includes('expanded_rows:Number(expanded.added_rows||0)'),'expanded-row count is not returned to the UI');
assert.match(api,/if \(\/发型师\|设计师\|店长\/.+nameSeeds\.push[\s\S]{0,220}if \(\/技师\|技工\|助理\/.+nameSeeds\.push/,'dual-role employees must be available in both report sections');

for(const marker of [
  'security definer',
  "set search_path = ''",
  'DAILY_STAFF_ROW_TARGET_INVALID',
  'daily_staff_rows_auto_expanded',
  'not between 1 and 20',
  'to service_role',
]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()),`adaptive-row safeguard missing: ${marker}`);
assert.match(migration,/revoke all on function public\.zysyr_expand_daily_sheet_staff_rows[\s\S]*?from public, anon, authenticated/,'adaptive-row RPC must not be browser callable');

console.log('ZYSYR v517 daily upload feedback and adaptive employee-row checks passed');
