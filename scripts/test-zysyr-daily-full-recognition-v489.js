#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'operations.html'),'utf8');
const client=fs.readFileSync(path.join(root,'operations-daily-recognition.js'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260912120743_daily_full_fidelity_recognition_jobs.sql'),'utf8');
const expect=(value,message)=>{if(!value)throw Error(message)};

new vm.Script(client,{filename:'operations-daily-recognition.js'});
for(const marker of ['daily_recognition_job_start','daily_recognition_job_read','daily_recognition_job_next','daily_recognition_job_control']){
  expect(api.includes(`operation === "${marker}"`),`API route missing: ${marker}`);
  expect(client.includes(`api('${marker}'`),`client call missing: ${marker}`);
}
for(const marker of ['zysyr_daily_recognition_jobs','zysyr_daily_recognition_job_items','enable row level security','force row level security','zysyr_claim_daily_recognition_item','zysyr_finish_daily_recognition_item']){
  expect(migration.includes(marker),`durable job safeguard missing: ${marker}`);
}
expect(/revoke all on table[\s\S]*?from public,anon,authenticated,service_role/.test(migration),'job tables must not be browser accessible');
expect(migration.includes("row_label_source_method='manual'"),'manual name provenance missing');
expect(migration.includes("source_method='codex_local_candidate'"),'candidate provenance missing');
expect(migration.includes('not manual_override'),'manual value preservation missing');
expect(client.includes('退出本页后进度仍会保存'),'persistent progress guidance missing');
expect(client.includes("['running','pending'].includes(result.job.status)"),'automatic resume missing');
expect(client.includes('saved_row_names')&&client.includes('saved_text_cells'),'full recognition counts missing');
expect(page.includes("cell.ocr_text==null?cell.manual_text:cell.ocr_text"),'recognized text candidate is not rendered');
expect(page.includes("row_label_source_method==='codex_local_candidate'"),'recognized name candidate is not highlighted');
console.log('ZYSYR daily full-fidelity candidates and durable month progress checks passed');
