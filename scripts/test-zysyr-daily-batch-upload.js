#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),batch=require('../operations-daily-batch-upload.js');
const ctx={store:'synthetic',month:'2026-11',locked:true,days:[{report_date:'2026-11-01',status:'posted'}]};
const row=(day='01')=>({file:{name:'photo.png',type:'image/png',size:10},date:'2026-11-'+day,status:'pending',confirmed:true});
const response=p=>({status:'archived',request_id:p.request_id,archive:{request_id:p.request_id,report_date:p.report_date,sha256:'hash',size_bytes:10,mime_type:p.mime_type,original_filename:p.filename}});
const deps=(extra={})=>Object.assign({current:()=>true,update:()=>{},hash:async()=> 'hash',requestId:()=> 'request-id',capture:()=>{},encode:async()=> 'synthetic',upload:async p=>response(p)},extra);
(async()=>{
 for(const day of ['01','02','30'])assert.equal(batch.targetFor('2026-11-'+day,ctx),'2026-11-'+day);
 for(const day of ['2026-11-31','2026-10-01'])assert.throws(()=>batch.targetFor(day,ctx));
 assert.equal(batch.suggestedDate('2026-11-02.png',ctx.month),'2026-11-02');
 assert.equal(batch.suggestedDate('2026-11-02_2026-11-03.png',ctx.month),'');
 assert.ok(batch.fileError({size:1,type:'image/heic'}));
 let rows=[row(),row('02')],order=[];
 assert.deepEqual(await batch.runBatch(rows,ctx,deps({capture:r=>order.push('capture:'+r.requestId),upload:async p=>{order.push('send:'+p.request_id);assert.equal(p.draft_id,undefined);return response(p);}})),{sent:2,stopped:false});
 assert.deepEqual(order,['capture:request-id','send:request-id','capture:request-id','send:request-id']);
 for(const phase of ['encode','hash','capture','upload']){
  let writes=0;rows=[row(),row('02')];let d=deps({upload:async p=>{writes++;return response(p);}});d[phase]=()=>{if(phase==='upload')writes++;throw Error('synthetic');};
  const result=await batch.runBatch(rows,ctx,d);assert.equal(result.stopped,true);assert.equal(writes,phase==='upload'?1:0);assert.equal(rows[0].status,phase==='upload'?'uncertain':'stopped');assert.equal(rows[1].status,'pending');
 }
 for(const phase of ['encode','hash','upload']){
  let current=true;rows=[row(),row('02')];let d=deps({current:()=>current}),fn=d[phase];d[phase]=async p=>{const r=await fn(p);current=false;return r;};
  await batch.runBatch(rows,ctx,d);assert.equal(rows[0].status,phase==='upload'?'done':'stopped');assert.equal(rows[1].status,'pending');
 }
 rows=[row()];await batch.runBatch(rows,ctx,deps({upload:async()=>({status:'pending'})}));assert.equal(rows[0].status,'uncertain');assert.equal(rows[0].requestId,'request-id');
 let writes=0;await batch.runBatch(rows,ctx,deps({upload:async()=>writes++}));assert.equal(writes,0);
 for(const change of [{report_date:'2026-11-02'},{sha256:'wrong'},{request_id:'wrong'},{size_bytes:11},{mime_type:'image/jpeg'},{original_filename:'other'}]){const r=response({request_id:'request-id',report_date:'2026-11-01',mime_type:'image/png',filename:'photo.png'});Object.assign(r.archive,change);assert.equal(batch.archiveMatches(r,rows[0]),false);}
 const source=fs.readFileSync(require.resolve('../operations-daily-batch-upload.js'),'utf8');
 for(const op of ['daily_sheet_create','daily_sheet_confirm','daily_sheet_recognize','daily_sheet_save','daily_sheet_attachment_upload'])assert.equal(source.includes("api('"+op+"'"),false);
 assert.ok(source.includes("api('daily_original_archive_upload',payload,true)"));
 console.log('Full-month archive synthetic runner passed; no live uploads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
