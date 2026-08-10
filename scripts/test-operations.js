#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260810022101_zysyr_operations_foundation.sql'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();

function expect(value, message) {
  if (!value) throw new Error(message);
}

const script = html.match(/<script>([\s\S]*?)<\/script>/);
expect(script, 'operations inline script missing');
new vm.Script(script[1], { filename: 'operations.html' });

expect(new RegExp(`<html[^>]+data-version="${releaseVersion}"`).test(html), 'operations version must match current release');
expect(html.includes('经营驾驶舱') && html.includes('经营总览') && html.includes('收支明细'), 'operations core views missing');
expect(html.includes('即时待补凭证') && html.includes('data-filter="missing"'), 'urgent missing-voucher queue missing');
expect(html.includes('美管加已同步消费') && html.includes('不执行付款、退款、充值或自动收银'), 'cashier read-only boundary missing');
expect(html.includes("api('overview'") && html.includes("api('expense_save'") && html.includes("api('voucher_upload'"), 'protected data flows missing');
expect(html.includes("api('expense_import'") && html.includes('重复内容会自动跳过'), 'history import flow missing');
expect(html.includes("api('voucher_url'") && html.includes('打开私有凭证'), 'private voucher open flow missing');
expect(!html.includes('SUPABASE_SERVICE_ROLE_KEY'), 'service role key must never appear in operations HTML');
expect(html.includes('sb_publishable_'), 'browser must use a publishable Supabase key');
expect(admin.includes('href="operations.html"'), 'admin entry to operations missing');

expect(edge.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), 'Edge Function must keep service role server-side');
expect(edge.includes('zysyr_operations_sessions') && edge.includes('requireSession'), 'revalidated operations session missing');
expect(edge.includes('operationsRole') && edge.includes('personal_scope') && edge.includes('canWriteExpense'), 'role-based operations scope missing');
expect(edge.includes('mgj_service_records') && edge.includes('income_read_only_from_mgj'), 'read-only Meiguanjia income source missing');
expect(edge.includes('zysyr_expense_records') && edge.includes('cashier_untouched: true'), 'independent expense source or cashier boundary missing');
expect(edge.includes('MAX_VOUCHER_BYTES') && edge.includes('/storage/v1/object/sign/'), 'private voucher constraints or signed link missing');
expect(edge.includes('resolution=ignore-duplicates') && edge.includes('source_ref'), 'idempotent history import missing');
expect(edge.includes('store !==') || edge.includes('stores.includes(store)'), 'server-side store authorization missing');
expect(!edge.includes('SUPABASE_ANON_KEY'), 'Edge Function must not rely on a browser anon key');

['zysyr_stores', 'zysyr_operations_sessions', 'zysyr_expense_records', 'zysyr_voucher_attachments'].forEach((table) => {
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`revoke all on table public.${table} from public, anon, authenticated`), `${table} browser revoke missing`);
  expect(migration.includes(`grant select, insert, update, delete on table public.${table} to service_role`), `${table} service-role grant missing`);
});
expect(migration.includes("'zysyr-vouchers'") && migration.includes('public, file_size_limit, allowed_mime_types'), 'private voucher bucket definition missing');
expect(migration.includes('false,') && migration.includes("'image/jpeg'") && migration.includes("'application/pdf'"), 'voucher bucket privacy or MIME restrictions missing');
expect(migration.includes('never creates or changes a Meiguanjia cashier transaction'), 'database cashier boundary comment missing');

console.log('operations tests passed');
