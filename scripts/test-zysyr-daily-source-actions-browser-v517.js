/* Synthetic browser regression only; no production credentials or writes. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');
    res.end(bytes);
  });
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
      showView('daily-report');
      await new Promise(resolve=>setTimeout(resolve,50));
      const source=previewDailySheetData();
      source.draft.id='source-action-draft';
      source.permissions={write:true,upload_original:true};
      source.readonly=false;source.locked=false;
      source.attachments[0].voucher_id='source-action-voucher';
      state.imports.sheet=source;state.imports.dirty={};state.imports.dirtyLabels={};
      currentStore=()=> '向里造型';
      isLocalPreview=()=>false;
      window.sourceActionCalls=0;
      api=async(operation,payload)=>{
        if(operation!=='daily_sheet_recognize')throw new Error('Unexpected operation: '+operation);
        window.sourceActionCalls++;
        if(payload.draft_id!=='source-action-draft'||payload.voucher_id!=='source-action-voucher')throw new Error('Wrong recognition target');
        await new Promise(resolve=>setTimeout(resolve,180));
        const sheet=structuredClone(source);sheet.draft.edit_revision++;
        return{sheet,cells:[],text_cells:[],row_names:[],warnings:[],expanded_rows:3,
          saved:{saved_cells:0,saved_text_cells:0,saved_row_names:0,manual_cells_preserved:2}};
      };
      renderDailySheetDetail();
    });
    const upload=page.locator('#daily-detail-upload'),recognize=page.locator('#daily-recognize'),status=page.locator('#daily-source-action-status');
    const initial=await page.evaluate(()=>({uploadVisible:!document.getElementById('daily-detail-upload').hidden,recognizeVisible:!document.getElementById('daily-recognize').hidden,detailHidden:document.getElementById('daily-report-detail').classList.contains('hidden'),viewHidden:document.getElementById('view-daily-report').classList.contains('hidden'),uploadDisabled:document.getElementById('daily-detail-upload').disabled,recognizeDisabled:document.getElementById('daily-recognize').disabled}));
    assert.deepEqual(initial,{uploadVisible:true,recognizeVisible:true,detailHidden:false,viewHidden:false,uploadDisabled:false,recognizeDisabled:false});
    assert.match(await upload.textContent(),/上传原始日报/);assert.match(await recognize.textContent(),/Codex识别当前原图/);
    if(viewport.width<600){
      const widths=await page.evaluate(()=>[document.getElementById('daily-detail-upload').getBoundingClientRect().width,document.getElementById('daily-recognize').getBoundingClientRect().width]);
      widths.forEach(width=>assert.ok(width>330,'mobile source action must be prominent and full width'));
    }
    await page.evaluate(()=>document.getElementById('daily-recognize').click());
    await page.waitForFunction(()=>document.getElementById('daily-recognize').disabled&&document.getElementById('daily-detail-upload').disabled);
    assert.match(await recognize.textContent(),/正在识别，请勿重复点击/);
    assert.match(await status.textContent(),/请勿重复点击/);
    await page.evaluate(()=>document.getElementById('daily-recognize').click());
    assert.equal(await page.evaluate(()=>window.sourceActionCalls),1,'disabled recognition must not submit twice');
    await page.waitForFunction(()=>document.getElementById('daily-source-action-status').textContent.includes('识别完成'));
    assert.match(await status.textContent(),/已按在职人数自动新增 3 行员工格子/);
    assert.match(await status.textContent(),/保留财务已填 2 项/);
    assert.equal(await upload.isEnabled(),true);assert.equal(await recognize.isEnabled(),true);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('ZYSYR v517 daily source actions: prominent mobile/desktop controls, single-flight feedback and completion state passed');
}
run().finally(async()=>{if(browser)await browser.close();server.close();}).catch(error=>{console.error(error);process.exitCode=1;});
