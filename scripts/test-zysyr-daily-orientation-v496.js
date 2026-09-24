#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=path.resolve(__dirname,'..');
const client=fs.readFileSync(path.join(root,'operations-daily-recognition.js'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260913033822_daily_attachment_orientation_revisions.sql'),'utf8');
const compatibilityMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260913043516_zysyr_service_role_claims_compat.sql'),'utf8');
const expect=(value,message)=>{if(!value)throw Error(message)};

new vm.Script(client,{filename:'operations-daily-recognition.js'});
expect(client.includes('data-save-orientation'),'save direction control missing');
expect(client.includes("api('daily_attachment_orientation_save'"),'save direction API call missing');
expect(client.includes('display_rotation_degrees'),'saved direction is not restored from attachment data');
expect(client.includes('退出或刷新后仍会保持'),'persistent-save feedback missing');
expect(api.includes('operation === "daily_attachment_orientation_save"'),'save direction API route missing');
expect(api.includes('zysyr_daily_attachment_orientation_revisions?select='),'latest orientation readback missing');
expect(api.includes('save_orientation: hasAuthCapability(session, "daily_report.write")'),'finance capability guard missing');
for(const marker of ['create table public.zysyr_daily_attachment_orientation_revisions','enable row level security','force row level security','zysyr_save_daily_attachment_orientation','source_object_unchanged','protect_report_trace_history']){
  expect(migration.includes(marker),'migration safeguard missing: '+marker);
}
expect(/revoke all on table public\.zysyr_daily_attachment_orientation_revisions[\s\S]*?from public, anon, authenticated, service_role/.test(migration),'orientation history grants are too broad');
expect(/revoke execute on function public\.zysyr_save_daily_attachment_orientation[\s\S]*?from public, anon, authenticated, service_role/.test(migration),'orientation RPC is browser accessible');
expect(migration.includes("current_setting('request.jwt.claim.role', true)"),'service-role RPC guard missing');
expect(compatibilityMigration.includes("current_setting('request.jwt.claims', true)"),'full JWT claims compatibility missing');
expect(compatibilityMigration.includes('zysyr_private.request_role()'),'shared request-role guard missing');
expect(migration.includes("degrees in (0, 90, 180, 270)"),'orientation degree constraint missing');
console.log('ZYSYR daily attachment orientation persistence checks passed');
