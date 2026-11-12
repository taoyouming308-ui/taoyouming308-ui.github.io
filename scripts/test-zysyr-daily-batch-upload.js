#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const batch = require('../operations-daily-batch-upload.js');
let checks = 0;
function check(value, expected) { assert.deepEqual(value, expected); checks++; }
const context = {store:'测试门店',month:'2026-11',days:[{report_date:'2026-11-01',draft_id:'d1',status:'draft'},{report_date:'2026-11-02',draft_id:'d2',status:'draft'},{report_date:'2026-11-03',draft_id:'d3',status:'confirmed'},{report_date:'2026-11-04',draft_id:'d4',status:'draft',locked:true}]};
function row(day='01') { return {file:{name:`2026-11-${day}.jpg`,size:100,type:'image/jpeg'},date:`2026-11-${day}`,confirmed:true,status:'pending'}; }
function deps(overrides={}) { return Object.assign({current:()=>true,update:()=>{},encode:async()=> 'synthetic',read:async payload=>({draft:{id:payload.draft_id,report_date:payload.draft_id==='d1'?'2026-11-01':'2026-11-02',status:'draft'},permissions:{upload_original:true}}),upload:async payload=>({attachment_uploaded:true,draft:{id:payload.draft_id,report_date:payload.draft_id==='d1'?'2026-11-01':'2026-11-02'}})},overrides); }
(async()=>{
  check(batch.validDate('2026-11-30','2026-11'),true);
  for (const date of ['2026-11-31','2026-10-01','2026-11-00','2026-11-1']) check(batch.validDate(date,'2026-11'),false);
  check(batch.validDate('2024-02-29','2024-02'),true); check(batch.validDate('2026-02-29','2026-02'),false);
  check(batch.suggestedDate('日报2026-11-02.jpg','2026-11'),'2026-11-02');
  check(batch.suggestedDate('IMG_0023.jpg','2026-11'),'');
  check(batch.suggestedDate('2026-11-01_2026-11-02.jpg','2026-11'),'');
  check(batch.suggestedDate('2026-10-01.jpg','2026-11'),'');
  check(batch.fileError({type:'image/jpeg',size:10*1024*1024}),'');
  for (const file of [{size:0,type:'image/jpeg'},{size:1,type:'image/heic'},{size:10*1024*1024+1,type:'image/png'}]) {assert.ok(batch.fileError(file)); checks++;}
  for (const date of ['2026-11-03','2026-11-04','2026-11-05','2026-10-01']) {assert.throws(()=>batch.targetFor(date,context));checks++;}
  assert.throws(()=>batch.targetFor('2026-11-01',{...context,locked:true}));checks++;
  assert.throws(()=>batch.targetFor('2026-11-01',{...context,days:[context.days[0],context.days[0]]}));checks++;
  let rows=[row(),row('02')], calls=[];
  let result=await batch.runBatch(rows,context,deps({upload:async p=>{calls.push(p);return {attachment_uploaded:true,draft:{id:p.draft_id,report_date:p.draft_id==='d1'?'2026-11-01':'2026-11-02'}};}}));
  check(result,{sent:2,stopped:false});check(calls.map(p=>[p.store,p.draft_id,p.attachment_kind]),[['测试门店','d1','original_report'],['测试门店','d2','original_report']]);check(rows.map(r=>r.status),['done','done']);
  for(const phase of ['read','encode','upload']) {
    rows=[row(),row('02')];let writes=0;
    const overrides={upload:async()=>{writes++;throw Error('network lost');}};
    overrides[phase]=async()=>{if(phase==='upload')writes++;throw Error('synthetic failure');};
    result=await batch.runBatch(rows,context,deps(overrides));
    check(writes,phase==='upload'?1:0);check(rows[0].status,phase==='upload'?'uncertain':'stopped');check(rows[1].status,'pending');check(result.stopped,true);
  }
  for (const fresh of [{draft:{id:'d1',report_date:'2026-11-02',status:'draft'},permissions:{upload_original:true}},{draft:{id:'wrong',report_date:'2026-11-01',status:'draft'},permissions:{upload_original:true}},{draft:{id:'d1',report_date:'2026-11-01',status:'confirmed'},permissions:{upload_original:true}},{draft:{id:'d1',report_date:'2026-11-01',status:'draft'},permissions:{upload_original:false}},{draft:{id:'d1',report_date:'2026-11-01',status:'draft'},permissions:{upload_original:true},locked:true}]) {
    let writes=0; await batch.runBatch([row()],context,deps({read:async()=>fresh,upload:async()=>writes++}));check(writes,0);
  }
  for(const phase of ['read','encode','upload']) {
    let current=true,writes=0;rows=[row(),row('02')];const d=deps({current:()=>current});const original=d[phase];
    d[phase]=async p=>{if(phase==='upload')writes++;const result=await original(p);current=false;return result;};
    result=await batch.runBatch(rows,context,d);check(rows[0].status,phase==='upload'?'done':'stopped');check(rows[1].status,'pending');check(result.sent,phase==='upload'?1:0);
  }
  let writes=0; rows=[row()];rows[0].confirmed=false;await batch.runBatch(rows,context,deps({upload:async()=>writes++}));check(writes,0);
  rows=[row(),row('02')];result=await batch.runBatch(rows,context,deps({upload:async()=>({})}));check(result.uncertain,true);check(rows[1].status,'pending');
  writes=0;await batch.runBatch(rows,context,deps({upload:async()=>{writes++;throw Error('must not retry uncertain first row');},current:()=>false}));check(writes,0);
  const source=fs.readFileSync(require.resolve('../operations-daily-batch-upload.js'),'utf8');
  for(const forbidden of ["api('daily_sheet_create'","api('daily_sheet_confirm'","api('daily_sheet_recognize'","api('daily_sheet_save'"]) {check(source.includes(forbidden),false);}
  check(source.includes("api('daily_sheet_attachment_upload',payload,true)"),true);
  check(source.includes('URL.revokeObjectURL'),true);
  check(fs.readFileSync(require.resolve('../operations.html'),'utf8').includes('operations-daily-batch-upload.js?v='),true);
  console.log(`Daily original batch: ${checks} synthetic assertions passed; no live uploads.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
