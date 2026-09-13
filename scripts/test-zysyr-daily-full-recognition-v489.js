#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'operations.html'),'utf8');
const client=fs.readFileSync(path.join(root,'operations-daily-recognition.js'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/operations-api/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260912120743_daily_full_fidelity_recognition_jobs.sql'),'utf8');
const retryMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260913022849_daily_recognition_single_item_retry.sql'),'utf8');
const rerunMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260913030006_daily_recognition_rerun_completed.sql'),'utf8');
const expect=(value,message)=>{if(!value)throw Error(message)};

new vm.Script(client,{filename:'operations-daily-recognition.js'});
for(const marker of ['daily_recognition_job_start','daily_recognition_job_read','daily_recognition_job_next','daily_recognition_job_control','daily_recognition_item_retry']){
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
expect(client.includes('data-recognition-review')&&client.includes('openDailyReportDay(item.report_date,item.draft_id'),'successful date does not open its daily report');
expect(client.includes('data-recognition-failure')&&client.includes('失败原因：'),'failed date does not expose its exact reason');
expect(client.includes("api('daily_recognition_item_retry'")&&client.includes('重新识别'),'single-day retry action missing');
expect(retryMigration.includes('zysyr_retry_daily_recognition_item'),'single-day retry RPC missing');
expect(retryMigration.includes("status<>'failed'")&&retryMigration.includes('attempt_count>=10'),'single-day retry state safeguards missing');
expect(/revoke all on function public\.zysyr_retry_daily_recognition_item[\s\S]*?from public,anon,authenticated/.test(retryMigration),'single-day retry RPC is browser accessible');
expect(rerunMigration.includes("status not in ('succeeded','failed')"),'successful dates cannot be rerun');
expect(rerunMigration.includes("status='draft'")&&rerunMigration.includes('FINANCE_PERIOD_LOCKED'),'confirmed or locked daily report rerun safeguards missing');
expect(client.includes('data-recognition-rerun')&&client.includes('成功和失败日期都可单独重新识别'),'completed-date rerun control missing');
expect(client.includes('automaticAngle')&&client.includes('availableHeight')&&client.includes('stage.scrollLeft'),'automatic straightening or centered rotation missing');
expect(page.includes('image.__setRotationZoom'),'legacy zoom does not share the centered rotation calculation');
expect(page.includes("cell.ocr_text==null?cell.manual_text:cell.ocr_text"),'recognized text candidate is not rendered');
expect(page.includes("row_label_source_method==='codex_local_candidate'"),'recognized name candidate is not highlighted');
console.log('ZYSYR daily full-fidelity candidates and durable month progress checks passed');
