// Synthetic DOM/API only; production sessions and non-local network are blocked.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(b);});});
let browser;
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/operations.html?preview=1&role=finance');
  await page.evaluate(async()=>{
   await showView('daily-report');const s=previewDailySheetData();s.draft={...s.draft,id:'synthetic-draft',report_date:'2026-10-09',status:'confirmed',edit_revision:4};
   s.permissions={write:false,correct_confirmed:true};s.attachments=[];s.history=[];window.syntheticSheet=s;
   state.user.can_correct_confirmed_daily=false;state.imports.sheet=structuredClone(s);state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
   window.syntheticOperations=[];window.syntheticApplied=false;window.syntheticLost=false;window.syntheticStatusFail=false;
   api=async(op,p)=>{syntheticOperations.push(op);if(op==='daily_recognition_job_read')return {job:null};
    if(op==='daily_sheet_correction_status'){if(syntheticStatusFail)throw Error('synthetic offline');return {applied:syntheticApplied};}
    if(op==='daily_sheet_correct'){syntheticApplied=true;syntheticSheet.draft.edit_revision=5;if(syntheticLost)throw Error('synthetic reply lost');return {corrected:true,saved:{request_id:p.request_id}};}
    if(op==='daily_sheet_read')return structuredClone(syntheticSheet);throw Error('Unexpected '+op);};
   isLocalPreview=()=>false;const originalControls=calculateDailyControls;calculateDailyControls=(g)=>({...originalControls(g),valid:true});window.confirm=()=>true;
  });
  assert.equal(await page.locator('#daily-correction-actions').isVisible(),false,'ordinary users have no correction entry');
  await page.evaluate(()=>{state.user.can_correct_confirmed_daily=true;renderDailyDetailControls();});
  await page.locator('#daily-correction-start').click();
  const input=page.locator('#daily-detail-grid [data-daily-cell]').first();assert.equal(await input.evaluate(e=>e.readOnly),false);
  await input.fill('120');assert.ok(await page.evaluate(()=>dailySheetDirtyCount()>0),'real input handler records corrections');
  assert.equal(await page.evaluate(()=>ensureDailySheetSaved()),false,'navigation must not trigger legacy draft autosave');
  await page.locator('#daily-correction-submit').click();assert.ok((await page.locator('#daily-detail-note').textContent()).includes('必须填写'));
  await page.locator('#daily-correction-cancel').click();assert.equal(await page.evaluate(()=>dailySheetDirtyCount()),0);assert.equal(await input.evaluate(e=>e.readOnly),true);
  await page.locator('#daily-correction-start').click();await page.locator('#daily-detail-grid [data-daily-cell]').first().fill('130');await page.locator('#daily-detail-reason').fill('Synthetic reviewed correction');
  await page.evaluate(()=>{syntheticLost=true;syntheticStatusFail=true;});await page.locator('#daily-correction-submit').click();
  await page.waitForFunction(()=>document.getElementById('daily-correction-submit').textContent==='查询更正结果');
  assert.equal(await page.locator('#daily-detail-grid [data-daily-cell]').first().evaluate(e=>e.readOnly),true);
  await page.evaluate(()=>{syntheticStatusFail=false;});await page.locator('#daily-correction-submit').click();
  await page.waitForFunction(()=>state.imports.sheet.draft.edit_revision===5&&!ZysyrDailyCorrection.protectedInput());
  const ops=await page.evaluate(()=>syntheticOperations);assert.equal(ops.filter(x=>x==='daily_sheet_correct').length,1);assert.equal(ops.some(x=>['daily_sheet_save','daily_sheet_confirm'].includes(x)),false);
  assert.equal(await page.locator('#daily-detail-grid [data-daily-cell]').first().evaluate(e=>e.readOnly),true);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Admin correction browser: desktop/mobile, denied entry, edit tracking, no autosave, required reason, cancel and lost-response read-only recovery passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
