#!/usr/bin/env node
// Synthetic browser regression only; no production credentials or writes.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(bytes);});
});
let browser;
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin+'/operations.html?preview=1&role=finance');
    await page.evaluate(async()=>{
      showView('daily-report');await new Promise(resolve=>setTimeout(resolve,50));
      const sheet=previewDailySheetData();sheet.draft.id='void-draft';sheet.permissions={write:true,upload_original:true,void_original:true,save_orientation:true};sheet.readonly=false;sheet.locked=false;
      sheet.attachments[0].id='wrong-link';sheet.attachments[0].voucher_id='wrong-voucher';sheet.attachments[0].original_filename='传错日期.jpg';sheet.attachments[0].voided=false;
      state.imports.sheet=sheet;state.imports.dirty={};state.imports.dirtyLabels={};currentStore=()=> '向里造型';isLocalPreview=()=>false;
      window.confirm=()=>true;window.prompt=()=> '上传错了日期';window.voidCalls=[];
      api=async(operation,payload)=>{if(operation!=='daily_sheet_attachment_void')throw new Error('Unexpected operation: '+operation);window.voidCalls.push(payload);const next=structuredClone(sheet);next.draft.source_voucher_id=null;next.original_image_url=null;next.original_filename=null;next.attachments[0].voided=true;next.attachments[0].void_reason=payload.reason;return next;};
      renderDailySheetDetail();
    });
    assert.match(await page.locator('#daily-detail-upload').textContent(),/上传 \/ 重传正确日报/);
    const voidButton=page.locator('[data-daily-attachment-void]');assert.equal(await voidButton.count(),1);assert.match(await voidButton.textContent(),/误传作废/);
    await voidButton.click();await page.waitForFunction(()=>window.voidCalls.length===1);
    const call=await page.evaluate(()=>window.voidCalls[0]);assert.deepEqual(call,{store:'向里造型',draft_id:'void-draft',attachment_id:'wrong-link',reason:'上传错了日期'});
    assert.equal(await page.locator('[data-daily-attachment-void]').count(),0);
    assert.match(await page.locator('#daily-detail-attachments').textContent(),/已作废（误传）/);
    assert.match(await page.locator('#daily-detail-attachments').textContent(),/原文件仍永久留底/);
    assert.match(await page.locator('#daily-detail-original-alert').textContent(),/缺少有效原始日报表/);
    assert.equal(await page.locator('#daily-detail-preview').evaluate(node=>node.classList.contains('hidden')),true);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('ZYSYR v518 daily mistaken-upload browser: explicit void, audit wording, active preview exclusion and reupload guidance passed');
}
run().finally(async()=>{if(browser)await browser.close();server.close();}).catch(error=>{console.error(error);process.exitCode=1});
