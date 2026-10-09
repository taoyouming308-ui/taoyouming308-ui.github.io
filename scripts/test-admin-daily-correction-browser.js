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
   document.getElementById('month').insertAdjacentHTML('beforeend','<option value="2026-10">2026年10月</option>');document.getElementById('month').value='2026-10';
   window.syntheticCalendar={month:'2026-10',days:[{report_date:'2026-10-09',draft_id:s.draft.id,status:'confirmed',grand_total:120,edit_revision:4,source:'electronic'}]};
   state.dailyReportMonth=structuredClone(syntheticCalendar);renderDailyReportCalendar(state.dailyReportMonth);
   state.user.can_correct_confirmed_daily=false;state.imports.sheet=structuredClone(s);state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
   window.syntheticOperations=[];window.syntheticApplied=false;window.syntheticLost=false;window.syntheticStatusFail=false;
   api=async(op,p)=>{syntheticOperations.push(op);if(op==='daily_recognition_job_read')return {job:null};
    if(op==='daily_sheet_correction_status'){if(syntheticStatusFail)throw Error('synthetic offline');return {applied:syntheticApplied};}
    if(op==='daily_sheet_correct'){if(window.syntheticHold)await new Promise(r=>window.syntheticRelease=r);syntheticApplied=true;syntheticSheet.draft.edit_revision=5;if(syntheticLost)throw Error('synthetic reply lost');return {corrected:true,saved:{request_id:p.request_id}};}
    if(op==='daily_sheet_read')return structuredClone(syntheticSheet);throw Error('Unexpected '+op);};
   const correctionApi=api;api=async(op,p)=>{if(op==='daily_sheet_month'){syntheticOperations.push(op);if(window.syntheticCalendarFail)throw Error('synthetic calendar offline');return {...structuredClone(syntheticCalendar),days:[{...syntheticCalendar.days[0],grand_total:190,edit_revision:5}]};}return correctionApi(op,p);};
   isLocalPreview=()=>false;window.syntheticOriginalControls=calculateDailyControls;window.confirm=()=>true;
  });
  assert.equal(await page.locator('#daily-correction-actions').isVisible(),false,'ordinary users have no correction entry');
  await page.evaluate(()=>{state.user.can_correct_confirmed_daily=true;renderDailyDetailControls();});
  await page.locator('#daily-correction-start').click();
  assert.equal(await page.locator('#daily-detail-reason').evaluate(e=>e.closest('#daily-correction-panel')!==null),true,'mandatory reason belongs beside correction actions, not beneath long grid');
  const input=page.locator('#daily-detail-grid [data-daily-cell]').first();assert.equal(await input.evaluate(e=>e.readOnly),false);
  await input.fill('120');assert.ok(await page.evaluate(()=>dailySheetDirtyCount()>0),'real input handler records corrections');
  assert.equal(await page.evaluate(()=>ensureDailySheetSaved()),false,'navigation must not trigger legacy draft autosave');
  await page.locator('#daily-correction-submit').click();assert.ok((await page.locator('#daily-detail-note').textContent()).includes('必须填写'));
  assert.equal(await page.locator('#daily-detail-reason').evaluate(e=>e===document.activeElement),true,'missing reason receives focus');
  await page.locator('#daily-detail-reason').fill('Synthetic validation test');
  await page.locator('#daily-correction-submit').click();
  assert.match(await page.locator('#daily-correction-status').textContent(),/差异/,'actual calculation blocks invalid amounts with visible feedback');
  await page.waitForFunction(()=>{const r=document.getElementById('daily-correction-status').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
  assert.equal(await page.evaluate(()=>syntheticOperations.includes('daily_sheet_correct')),false,'invalid totals never reach write API');
  await page.evaluate(()=>{calculateDailyControls=()=>{throw Error('synthetic calculation failure');};});
  await page.locator('#daily-correction-submit').click();
  assert.match(await page.locator('#daily-correction-status').textContent(),/本页校验失败/,'preflight exceptions cannot silently swallow clicks');
  await page.evaluate(()=>{calculateDailyControls=syntheticOriginalControls;});
  await page.locator('#daily-correction-cancel').click();assert.equal(await page.evaluate(()=>dailySheetDirtyCount()),0);assert.equal(await input.evaluate(e=>e.readOnly),true);
  await page.locator('#daily-correction-start').click();await page.locator('#daily-detail-grid [data-daily-cell]').first().fill('130');await page.locator('#daily-detail-reason').fill('Synthetic reviewed correction');
  await page.evaluate(()=>{calculateDailyControls=g=>({...syntheticOriginalControls(g),valid:true});window.confirm=()=>false;});
  await page.locator('#daily-correction-submit').click();
  assert.match(await page.locator('#daily-correction-status').textContent(),/未确认/);
  assert.equal(await page.evaluate(()=>syntheticOperations.includes('daily_sheet_correct')),false);
  await page.evaluate(()=>{window.confirm=()=>true;syntheticHold=true;});
  await page.evaluate(()=>{syntheticLost=true;syntheticStatusFail=true;});await page.locator('#daily-correction-submit').click();
  await page.waitForFunction(()=>typeof syntheticRelease==='function');
  assert.equal(await page.locator('#daily-correction-submit').textContent(),'正在核对…','pending request gives immediate button feedback');
  assert.equal(await page.locator('#daily-correction-submit').isDisabled(),true);
  assert.match(await page.locator('#daily-correction-status').textContent(),/正在提交/);
  await page.evaluate(()=>syntheticRelease());
  await page.waitForFunction(()=>document.getElementById('daily-correction-submit').textContent==='查询更正结果');
  assert.equal(await page.locator('#daily-detail-grid [data-daily-cell]').first().evaluate(e=>e.readOnly),true);
  await page.evaluate(fail=>{syntheticStatusFail=false;syntheticCalendarFail=fail;},width===390);await page.locator('#daily-correction-submit').click();
  await page.waitForFunction(()=>state.imports.sheet.draft.edit_revision===5&&!ZysyrDailyCorrection.protectedInput());
  await page.waitForFunction(()=>syntheticOperations.includes('daily_sheet_month'));
  if(width===390){
   await page.waitForFunction(()=>document.getElementById('daily-correction-status').textContent.includes('月历暂时刷新失败'));
   assert.equal(await page.evaluate(()=>state.dailyReportMonth),null,'failed read cannot retain stale cache');
   assert.doesNotMatch(await page.locator('#daily-report-calendar').textContent(),/¥120/,'failed refresh removes old visible amounts');
   await page.evaluate(()=>{syntheticCalendarFail=false;backToDailyReportCalendar();});
  }
  await page.waitForFunction(()=>state.dailyReportMonth?.days[0].grand_total===190);
  assert.match(await page.locator('[data-daily-day="2026-10-09"] .day-total').textContent(),/¥190(?:\.00)?$/);
  assert.match(await page.locator('.daily-month-summary').textContent(),/¥190(?:\.00)?$/,'month sum also updates');
  await page.evaluate(()=>backToDailyReportCalendar());
  assert.match(await page.locator('[data-daily-day="2026-10-09"] .day-total').textContent(),/¥190(?:\.00)?$/,'return does not resurrect stale DOM');
  assert.equal(await page.locator('#daily-detail-reason').evaluate(e=>e.closest('.daily-electronic')!==null&&!e.closest('#daily-correction-panel')),true,'ordinary reason placement is restored after correction');
  const ops=await page.evaluate(()=>syntheticOperations);assert.equal(ops.filter(x=>x==='daily_sheet_correct').length,1);assert.equal(ops.some(x=>['daily_sheet_save','daily_sheet_confirm'].includes(x)),false);
  assert.equal(await page.locator('#daily-detail-grid [data-daily-cell]').first().evaluate(e=>e.readOnly),true);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Admin correction browser: desktop/mobile, required reason beside actions, visible actual-validation failure, preflight exceptions, cancelled confirmation, immediate pending feedback, denied entry, no autosave and lost-response read-only recovery passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
