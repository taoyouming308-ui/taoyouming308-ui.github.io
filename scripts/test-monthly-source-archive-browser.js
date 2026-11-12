#!/usr/bin/env node
// Synthetic workbook bytes / API fixtures. No live auth, upload, ledger or storage.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'operations.html'),'utf8');
assert.ok(html.includes('id="monthly-source-archive"'));
assert.ok(html.includes('src="operations-monthly-source-archive.js?v='));
const fixture='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px sans-serif;margin:12px}.hidden{display:none!important}input,select{display:block;max-width:100%;box-sizing:border-box}button{padding:8px;margin:4px}section{max-width:900px}details{padding:8px}p{overflow-wrap:anywhere}</style></head><body><div id="app"><select id="store-select"><option value="store-a">门店A</option><option value="store-b">门店B</option></select><input id="month" value="2026-07"><section id="monthly-source-archive"></section></div></body></html>';
const server=http.createServer((req,res)=>{if(req.url==='/module.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(root,'operations-monthly-source-archive.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);}});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],origin='http://127.0.0.1:'+server.address().port;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(()=>{
   window.state={user:{id:'actor-a',username:'fixture',can_upload_reports:true}};
   window.currentStore=()=>document.getElementById('store-select').value;
   window.renderAll=()=>{};window.isLocalPreview=()=>false;
   window.fileBase64=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
   window.calls=[];window.mode='ok';window.sources=[];window.selections=[];window.lastSelection=null;
   window.api=async(op,p,retried)=>{
     calls.push({op,...p,retried});
     if(!op.startsWith('monthly_source_archive_'))throw Error('Forbidden financial/API action '+op);
     if(op.endsWith('_list'))return {sources:p.store==='store-a'?sources:[],selections,current_selection:p.store==='store-a'?(selections.find(s=>s.period_month===p.month+'-01')||null):null,has_more:false,next_offset:0};
     if(op.endsWith('_upload')||op.endsWith('_resume')){
       const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0)),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
       const archive={request_id:p.request_id,original_filename:p.filename,mime_type:p.mime_type,size_bytes:bytes.length,sha256:sha,worksheet_names:['7月','8月 ','9月'],status:'archived'};
       sources=sources.filter(x=>x.request_id!==p.request_id).concat(archive);
       if(mode==='upload-lost')throw Error('fixture lost upload reply');
       if(mode==='upload-hold')await new Promise(resolve=>window.finishUpload=resolve);
       return {status:'archived',request_id:p.request_id,archive,financial_records_unchanged:true};
     }
     if(op.endsWith('_selection_status'))return lastSelection?{...lastSelection}:{status:'not_found',selection_request_id:p.selection_request_id};
     if(op.endsWith('_status')){const archive=sources.find(s=>s.request_id===p.request_id);return archive?{status:'archived',request_id:p.request_id,archive}:{status:'not_found',request_id:p.request_id};}
     if(op.endsWith('_select')){
       if(mode==='select-not-found')throw Error('fixture before selection');
       const rows=p.bindings.map((b,i)=>({...b,id:'selection-'+i,selection_version:1,source_request_id:p.source_request_id,is_current:true}));
       selections=rows;lastSelection={status:'selected',selection_request_id:p.selection_request_id,source_request_id:p.source_request_id,source_sha256:p.expected_source_sha256,selections:rows,financial_records_unchanged:true};
       if(mode==='select-lost')throw Error('fixture lost select reply');return lastSelection;
     }
     if(op.endsWith('_url'))return {url:'https://example.invalid/private-original'};
     throw Error('Unexpected fixture '+op);
   };
 });
 await page.addScriptTag({url:origin+'/module.js'});
 const host=page.locator('#monthly-source-archive'),form=host.locator('[data-ms-form]');
 const file={name:'monthly-latest.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic original workbook bytes, not parsed by browser')};
 async function choose(){await form.locator('summary').click();await host.locator('[data-ms-file]').setInputFiles(file);await host.locator('[data-ms-start]').fill('2026-07');await host.locator('[data-ms-end]').fill('2026-09');await host.locator('[data-ms-upload]').click();}
 await choose();
 await page.waitForFunction(()=>document.querySelectorAll('[data-ms-sheet]').length===3);
 assert.equal(await host.locator('[data-ms-sheet="2026-08-01"]').inputValue(),'8月 ',await host.locator('[data-ms-bindings]').innerHTML());
 assert.match(await host.locator('[data-ms-status]').innerText(),/原件已留存/);
 await page.evaluate(()=>{const base=api;window.blockBindingRead=true;api=(op,p,retried)=>op.endsWith('_list')&&p.month==='2026-07'&&blockBindingRead?new Promise(resolve=>window.finishBinding=()=>base(op,p,retried).then(resolve)):base(op,p,retried);});
 await host.locator('[data-ms-end]').fill('2026-08');await host.locator('[data-ms-end]').dispatchEvent('change');
 await page.waitForFunction(()=>typeof finishBinding==='function');
 await page.evaluate(()=>blockBindingRead=false);await host.locator('[data-ms-end]').fill('2026-09');await host.locator('[data-ms-end]').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelectorAll('[data-ms-sheet]').length===3);
 await page.evaluate(()=>finishBinding());await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 assert.equal(await host.locator('[data-ms-sheet]').count(),3,'late shorter range must not replace latest mapping');
 await page.evaluate(()=>mode='select-lost');
 await host.locator('[data-ms-select]').click();await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('月份关联结果待核对'));
 const lostId=await page.evaluate(()=>calls.find(c=>c.op.endsWith('_select')).selection_request_id);
 await host.locator('[data-ms-query]').click();await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('原件已更新，金额未调整'));
 const binding=await page.evaluate(()=>calls.find(c=>c.op.endsWith('_select')));
 assert.deepEqual(binding.bindings,[{period_month:'2026-07-01',worksheet_name:'7月'},{period_month:'2026-08-01',worksheet_name:'8月 '},{period_month:'2026-09-01',worksheet_name:'9月'}]);
 assert.deepEqual(binding.expected_previous_selection_ids,{'2026-07-01':null,'2026-08-01':null,'2026-09-01':null});
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_select')).length),1);
 assert.equal(await page.evaluate(()=>calls.find(c=>c.op.endsWith('_selection_status')).selection_request_id),lostId);
 await host.locator('[data-ms-new]').click();
 await page.evaluate(()=>{mode='upload-lost';lastSelection=null;});
 await host.locator('[data-ms-file]').setInputFiles({...file,name:'other-original.xlsx'});await host.locator('[data-ms-upload]').click();
 await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('原件登记结果待核对'));
 const requestId=await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_upload')).at(-1).request_id);
 assert.equal(await host.locator('[data-ms-upload]').isDisabled(),true);
 await host.locator('[data-ms-query]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-ms-sheet]').length===3);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_upload')).length),2);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_status')&&!c.op.endsWith('_selection_status')).at(-1).request_id),requestId);
 await page.evaluate(()=>mode='select-not-found');await host.locator('[data-ms-select]').click();
 await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('月份关联结果待核对'));
 const retryId=await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_select')).at(-1).selection_request_id);
 await host.locator('[data-ms-query]').click();await page.waitForFunction(()=>!document.querySelector('[data-ms-retry-selection]').disabled);
 await host.locator('[data-ms-retry-selection]').click();
 await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('月份关联结果待核对'));
 assert.equal(await host.locator('[data-ms-retry-selection]').isVisible(),false,'each uncertain retry requires another readback');
 await host.locator('[data-ms-query]').click();await page.waitForFunction(()=>!document.querySelector('[data-ms-retry-selection]').disabled);
 await page.evaluate(()=>mode='ok');await host.locator('[data-ms-retry-selection]').click();
 await page.waitForFunction(()=>document.querySelector('[data-ms-status]').textContent.includes('原件已更新，金额未调整'));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.op.endsWith('_select')).at(-1).selection_request_id),retryId);
 assert.equal(await host.locator('[data-ms-list]').locator('strong').count(),2,'both originals remain visible');
 await host.locator('[data-ms-current] [data-ms-open]').click();
 assert.equal(await host.locator('[data-ms-current] a').getAttribute('href'),'https://example.invalid/private-original');
 assert.equal(await host.locator('[data-ms-current] a').getAttribute('target'),'_blank');
 await host.locator('[data-ms-new]').click();await page.evaluate(()=>mode='upload-hold');
 await host.locator('[data-ms-file]').setInputFiles({...file,name:'late-original.xlsx'});await host.locator('[data-ms-upload]').click();
 await page.waitForFunction(()=>typeof finishUpload==='function');
 await page.selectOption('#store-select','store-b');
 await page.waitForFunction(()=>!document.querySelector('[data-ms-list]').textContent.includes('original.xlsx'));
 await page.evaluate(()=>finishUpload());
 await page.waitForFunction(()=>!document.querySelector('[data-ms-upload]').disabled);
 assert.equal(await host.locator('[data-ms-bindings]').innerText(),'');
 assert.equal(await host.locator('[data-ms-list]').innerText().then(t=>t.includes('late-original')),false);
 await page.evaluate(()=>{state.user={id:'actor-read',can_upload_reports:false};renderAll();});
 assert.equal(await form.isVisible(),false);
 await page.evaluate(()=>{state.user=null;document.getElementById('app').classList.add('hidden');});
 await page.waitForFunction(()=>document.getElementById('monthly-source-archive').classList.contains('hidden'));
 assert.equal(await host.locator('[data-ms-list]').innerText(),'');
 assert.deepEqual(errors,[]);
 console.log('Monthly source browser passed: one original/three exact sheets, immutable old originals, lost upload/selection readback, same-request retry, cross-store late reply, read-only/logout privacy. Synthetic only.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
