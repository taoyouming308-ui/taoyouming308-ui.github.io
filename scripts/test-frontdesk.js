#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontdesk.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontdesk-manifest.json'), 'utf8'));
const edge = fs.readFileSync(path.join(root, 'supabase/functions/frontdesk-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805031104_frontdesk_customer_center.sql'), 'utf8');
const indexMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805032248_frontdesk_import_batch_index.sql'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
expect(scriptMatch, 'frontdesk inline script missing');
new Function(scriptMatch[1]);

expect(/<html[^>]+data-version="403"/.test(html), 'frontdesk version must match release 403');
expect(html.includes('前台客户中心') && html.includes('今日客户') && html.includes('客户档案'), 'core frontdesk views missing');
expect(html.includes('全部已同步消费记录') && html.includes('套餐余项'), 'customer history or package balance UI missing');
expect(html.includes('美管加历史明细尚未完整回传'), 'customer data-gap warning missing');
expect(html.includes('美管加负责收银') && html.includes('不会执行收银'), 'cashier responsibility boundary missing');
expect(html.includes("setInterval(function(){if(!document.hidden&&state.session&&state.view==='today')loadDashboard();},60000)"), 'one-minute foreground refresh missing');
expect(html.includes("accept=\".csv,.tsv"), 'CSV import entry missing');
expect(!html.includes('SUPABASE_SERVICE_ROLE_KEY'), 'service role key must never appear in frontdesk HTML');
expect(admin.includes('href="frontdesk.html"'), 'admin entry to frontdesk missing');

expect(manifest.start_url === 'frontdesk.html', 'frontdesk manifest start_url mismatch');
expect(manifest.display === 'standalone' && manifest.orientation === 'landscape', 'frontdesk iPad PWA settings missing');

expect(edge.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), 'Edge Function must read service role from environment');
expect(edge.includes('frontdesk_sessions') && edge.includes('requireSession'), 'protected frontdesk session missing');
expect(edge.includes('operation === "logout"') && edge.includes('async function logout'), 'server-side logout missing');
expect(edge.includes('/前台|店长/') && edge.includes('canImport'), 'frontdesk and manager permission checks missing');
expect(edge.includes('customer_profiles') && edge.includes('mgj_service_records'), 'Meiguanjia customer sources missing');
expect(edge.includes('summary_without_history'), 'server-side customer data-gap signal missing');
expect(edge.includes('rpc/import_frontdesk_records'), 'protected import RPC missing');
expect(edge.includes('单次最多导入 250 行'), 'import batch limit missing');

['frontdesk_sessions', 'frontdesk_import_batches', 'frontdesk_import_records'].forEach((table) => {
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`public.${table}`), `${table} migration missing`);
});
expect(migration.includes('revoke all on function public.import_frontdesk_records'), 'import RPC public revoke missing');
expect(migration.includes('grant execute on function public.import_frontdesk_records') && migration.includes('to service_role'), 'import RPC service-role grant missing');
expect(indexMigration.includes('frontdesk_import_records (batch_id)'), 'import batch foreign-key index missing');

console.log('frontdesk tests passed');
