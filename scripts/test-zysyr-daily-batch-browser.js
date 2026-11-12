#!/usr/bin/env node
// Synthetic photos and mocked APIs only; all external requests are blocked.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);});
});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+'/operations.html?preview=1&role=finance');
  await page.waitForFunction(()=>state.user && state.user.role==='finance');
  await page.evaluate(async()=>{await showView('daily-report');window.batchMonth=$('month').value;window.batchCalls=[];window.batchMode='ok';isLocalPreview=()=>false;
    api=async function(op,p){batchCalls.push({op,...p});const d=p.draft_id||'d1',day=d==='d1'?'01':'02';
      if(op==='daily_sheet_month')return {month:batchMonth,permissions:{write:true},days:[{report_date:batchMonth+'-01',draft_id:'d1',status:'draft'},{report_date:batchMonth+'-02',draft_id:'d2',status:'draft'},{report_date:batchMonth+'-03',draft_id:'d3',status:'confirmed'}]};
      if(op==='daily_sheet_read')return {draft:{id:d,report_date:batchMonth+'-'+day,status:'draft'},permissions:{upload_original:true}};
      if(op==='daily_sheet_attachment_upload'){if(batchMode==='fail')throw Error('synthetic lost response');if(batchMode==='pending')await new Promise(r=>window.finishUpload=r);return {attachment_uploaded:true,draft:{id:d,report_date:batchMonth+'-'+day}};}
      throw Error('Unexpected mocked operation '+op);
    };
  });
  const month=await page.evaluate(()=>batchMonth),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=','base64');
  const photo=day=>({name:month+'-'+day+'.png',mimeType:'image/png',buffer:png});
  const panel=page.locator('#daily-batch-panel');
  async function open(files){await page.locator('#daily-batch-upload').click();await panel.locator('input[type=file]').setInputFiles(files);}
  async function reset(){await panel.locator('[data-close]').click();}
  await open([photo('01'),photo('02')]);
  assert.equal(await panel.locator('img').count(),2);
  assert.equal(await panel.locator('[data-start]').isDisabled(),true);
  for(const cb of await panel.locator('input[type=checkbox]').all())await cb.check();
  await panel.locator('[data-start]').click();await page.waitForFunction(()=>document.querySelector('#daily-batch-panel [data-status]').textContent.includes('已确认上传 2 / 2'));
  assert.equal(await page.evaluate(()=>batchCalls.filter(x=>x.op==='daily_sheet_attachment_upload').length),2);
  assert.equal(await panel.locator('[data-start]').isDisabled(),true);
  await reset();await open([photo('03')]);await panel.locator('input[type=checkbox]').click();
  assert.match(await panel.innerText(),/已入账或不可编辑/);assert.equal(await panel.locator('[data-start]').isDisabled(),true);
  await reset();await page.evaluate(()=>batchMode='fail');await open([photo('01'),photo('02')]);
  for(const cb of await panel.locator('input[type=checkbox]').all())await cb.check();
  await panel.locator('[data-start]').click();await page.waitForFunction(()=>document.querySelector('#daily-batch-panel [data-status]').textContent.includes('结果待核对'));
  assert.equal(await page.evaluate(()=>batchCalls.filter(x=>x.op==='daily_sheet_attachment_upload').length),3);
  assert.equal(await panel.locator('[data-start]').isDisabled(),true);
  await reset();await page.evaluate(()=>batchMode='pending');await open([photo('01'),photo('02')]);
  for(const cb of await panel.locator('input[type=checkbox]').all())await cb.check();
  await panel.locator('[data-start]').click();await page.waitForFunction(()=>typeof finishUpload==='function');
  await panel.locator('[data-close]').click();await page.evaluate(()=>finishUpload());
  await page.waitForFunction(()=>document.querySelector('#daily-batch-panel [data-status]').textContent.includes('已确认上传 1 / 2'));
  assert.equal(await page.evaluate(()=>batchCalls.filter(x=>x.op==='daily_sheet_attachment_upload').length),4);
  await reset();await page.evaluate(()=>batchMode='ok');await open([photo('01')]);await panel.locator('input[type=checkbox]').check();
  await page.evaluate(()=>{document.getElementById('store-select').dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await panel.locator('[data-start]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>batchCalls.some(x=>['daily_sheet_create','daily_sheet_confirm','daily_sheet_recognize','daily_sheet_save'].includes(x.op))),false);
  assert.deepEqual(errors,[]);console.log('Daily batch browser: mobile preview/date confirmation, two originals, confirmed-date blocking, uncertain result, in-flight cancel and scope switch passed. No live upload.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
