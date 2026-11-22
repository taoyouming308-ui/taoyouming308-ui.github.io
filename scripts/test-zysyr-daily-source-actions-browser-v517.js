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
    assert.match(await upload.textContent(),/上传.*重传正确日报/);assert.match(await recognize.textContent(),/Codex识别当前原图/);
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
    await page.evaluate(()=>{
      state.imports.sheet.draft.template_code='zysyr_frontdesk_project_draft';
      state.imports.sheet.draft.ocr_raw_result={autofill:{manual_conflicts:[{name:'合成员工',column:'护理',current:77,source:100}]}};
      window.syncedBefore=JSON.stringify(state.imports.sheet);
      api=async(operation)=>{if(operation!=='daily_sheet_recognize')throw Error('unexpected write');return {saved:{comparison_only:true,differences:[{name:'<img src=x>',column:'护理',current:77,recognized:100}]},warnings:[]};};
      renderDailySheetDetail();
    });
    assert.match(await recognize.textContent(),/核对原图（不改表）/);
    assert.match(await page.locator('#daily-sync-conflicts').textContent(),/当前 77；同步 100/);
    await page.evaluate(()=>window.recognizeCurrentDaily());
    assert.match(await page.locator('#daily-recognition-comparison').textContent(),/1处差异（未改动表格）/);
    assert.equal(await page.locator('#daily-recognition-comparison img').count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.imports.sheet)===window.syncedBefore),true,'comparison cannot replace the current sheet');
    await page.evaluate(()=>{
      window.attachmentRequests=[];
      api=async(operation,payload)=>{
        if(operation!=='daily_sheet_attachment_upload')throw Error('unexpected write '+operation);
        window.attachmentRequests.push(payload);
        return structuredClone(state.imports.sheet);
      };
    });
    async function chooseFile(){
      const [chooser]=await Promise.all([page.waitForEvent('filechooser'),upload.click()]);
      await chooser.setFiles({name:'合成日报.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic only')});
      await page.locator('#upload-source-store-select').waitFor();
    }
    const storeSelect=page.locator('#upload-source-store-select');
    const confirmUpload=page.locator('#upload-source-store-dialog').getByRole('button',{name:'确认上传'});
    await chooseFile();
    assert.equal(await storeSelect.inputValue(),'');
    assert.equal(await confirmUpload.isDisabled(),true);
    await storeSelect.selectOption('自由手艺人');
    assert.equal(await confirmUpload.isDisabled(),true);
    await page.locator('#upload-source-store-dialog').getByRole('button',{name:'取消'}).click();
    assert.equal(await page.evaluate(()=>attachmentRequests.length),0);
    await chooseFile();
    await storeSelect.selectOption('向里造型');
    await page.evaluate(()=>{state.imports.sheet.draft.report_date='2026-04-02'});
    await confirmUpload.click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('日报已变化'));
    assert.equal(await page.evaluate(()=>attachmentRequests.length),0);
    await page.evaluate(()=>{state.imports.sheet.draft.report_date='2026-04-01'});
    await chooseFile();
    await storeSelect.selectOption('向里造型');
    page.once('dialog',dialog=>dialog.accept());
    await confirmUpload.click();
    await page.waitForFunction(()=>attachmentRequests.length===1);
    const request=await page.evaluate(()=>attachmentRequests[0]);
    assert.equal(request.store,'向里造型');assert.equal(request.source_store,'向里造型');
    assert.equal(request.draft_id,'source-action-draft');
    await page.evaluate(()=>{
      const sheet=previewDailySheetData();
      sheet.draft.id='synthetic-correction-draft';sheet.draft.status='draft';sheet.draft.edit_revision=4;
      sheet.permissions={write:true,fill_blanks:true,draft_source_correction:true};
      sheet.locked=false;sheet.readonly=false;
      const cells=sheet.cells.filter(c=>c.section_code==='stylist'&&c.cell_role==='staff_value'&&['perm','color'].includes(c.column_code)).slice(0,2);
      cells.forEach((c,i)=>Object.assign(c,{ocr_numeric:90+i,manual_override:false,corrected_numeric:null}));
      window.correctionItems=cells.map((c,i)=>({cell_id:c.id,row_label:c.row_label,column_label:c.column_label,before_value:90+i,suggested_value:100+i}));
      window.correctionCalls=[];window.correctionStale=false;
      state.imports.sheet=sheet;state.imports.dirty={};state.imports.dirtyLabels={};
      state.user.role='finance';
      api=async(operation,payload)=>{
        correctionCalls.push({operation,payload});
        const scope={store:'向里造型',report_date:sheet.draft.report_date,draft_id:sheet.draft.id};
        if(operation==='daily_sheet_source_preview')return {...scope,status:'preview',revision:4,source_token:'a'.repeat(64),items:correctionItems};
        if(operation==='daily_sheet_source_correct')return correctionStale
          ? {...scope,status:'source_changed'} : {...scope,status:'saved',revision:5,changed_cells:1,formal_ledger_amount_changed:false};
        if(operation==='daily_sheet_read'){
          const fresh=structuredClone(sheet);fresh.draft.edit_revision=5;
          Object.assign(fresh.cells.find(c=>c.id===correctionItems[0].cell_id),{manual_override:true,corrected_numeric:100});
          return fresh;
        }
        throw Error('Unexpected operation '+operation);
      };
      renderDailySheetDetail();
    });
    const correction=page.getByRole('button',{name:'核对并纠正',exact:true});
    const review=page.locator('#daily-draft-source-review');
    const saveSelected=review.getByRole('button',{name:'保存所选纠正'});
    const items=review.getByRole('checkbox');
    const cellIds=await page.evaluate(()=>correctionItems.map(i=>i.cell_id));
    const cellInputs=cellIds.map(id=>page.locator('[data-daily-cell="'+id+'"]'));
    await correction.click();
    await review.waitFor();
    assert.equal(await items.count(),2);
    assert.equal(await items.first().isChecked(),false);assert.equal(await saveSelected.isDisabled(),true);
    assert.match(await review.textContent(),/当前 90\.00 元 → 建议 100\.00 元/);
    assert.equal(await cellInputs[0].inputValue(),'90');
    await items.first().check();
    await review.getByRole('button',{name:'取消'}).click();
    await review.waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>correctionCalls.map(c=>c.operation)),['daily_sheet_source_preview']);
    await page.evaluate(()=>{window.correctionStale=true;});
    await correction.click();await items.first().check();await saveSelected.click();
    await page.waitForFunction(()=>document.getElementById('daily-detail-note').textContent.includes('差异已变化'));
    assert.equal(await cellInputs[0].inputValue(),'90');
    await page.evaluate(()=>{window.correctionStale=false;window.correctionCalls=[];});
    await correction.click();await items.first().check();await saveSelected.click();
    await page.waitForFunction(()=>document.getElementById('daily-detail-note').textContent.includes('已纠正 1 格并保存草稿，未入账'));
    assert.equal(await cellInputs[0].inputValue(),'100');assert.equal(await cellInputs[1].inputValue(),'91');
    const calls=await page.evaluate(()=>correctionCalls);
    assert.deepEqual(calls.map(c=>c.operation),['daily_sheet_source_preview','daily_sheet_source_correct','daily_sheet_read']);
    assert.deepEqual(calls[1].payload,{...calls[0].payload,source_token:'a'.repeat(64),selected_ids:[cellIds[0]],confirmed:true});
    await cellInputs[1].fill('92');
    assert.equal(await correction.isDisabled(),true);
    await page.evaluate(()=>{state.imports.dirty={};state.imports.sheet.draft.status='confirmed';renderDailyDetailControls();});
    assert.equal(await correction.isVisible(),false);
    await page.route('https://archive-test.invalid/**',async route=>{
      if(route.request().url().endsWith('/unavailable.png')) return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',
        body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+WnWQAAAAASUVORK5CYII=','base64')});
    });
    await page.evaluate(()=>{
      const sheet=previewDailySheetData();
      Object.assign(sheet.draft,{id:'synthetic-bind-draft',status:'draft',edit_revision:4,source_voucher_id:null});
      sheet.permissions={write:true,bind_archived_original:true};
      sheet.attachments=[];sheet.locked=false;sheet.readonly=false;
      const today=sheet.draft.report_date;
      const valid={report_date:today,mime_type:'image/png',request_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        private_url:'https://archive-test.invalid/source.png',original_filename:'当天正确原图'};
      sheet.original_archive={state:'archived',count:2};
      sheet.archived_originals=[valid,
        {...valid,request_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',original_filename:'前一天',report_date:'2026-01-01'},
        {...valid,request_id:'cccccccc-cccc-cccc-cccc-cccccccccccc',original_filename:'已经作废',voided:true},
        {...valid,request_id:'dddddddd-dddd-dddd-dddd-dddddddddddd',original_filename:'预览不可用',private_url:'https://archive-test.invalid/unavailable.png'}];
      window.archiveCalls=[];window.archiveCells=JSON.stringify(sheet.cells);
      let committed=false;
      api=async(operation,payload)=>{
        if(operation==='daily_sheet_read'){
          const fresh=structuredClone(sheet);
          if(committed){
            fresh.draft.edit_revision=5;fresh.draft.source_voucher_id=valid.request_id;
            fresh.attachments=[{id:'attachment-1',voucher_id:valid.request_id,audit_status:'approved',
              document_type:'daily_report',attachment_kind:'original_report',voided:false,mime_type:'image/png',private_url:valid.private_url}];
          }
          return fresh;
        }
        archiveCalls.push({operation,payload});
        if(operation!=='daily_sheet_attachment_bind_archive')throw Error('Unexpected write: '+operation);
        committed=true;
        // The link committed but the network did not deliver the response.
        throw Error('合成网络断开');
      };
      state.imports.sheet=sheet;renderDailySheetDetail();
    });
    const bind=page.getByRole('button',{name:'从存档选原图',exact:true});
    const picker=page.locator('#daily-archive-bind-dialog'),select=picker.getByRole('combobox');
    const confirmBind=picker.getByRole('button',{name:'确认绑定原图'});
    await bind.click();await picker.waitFor();
    assert.deepEqual(await select.locator('option').allTextContents(),['请选择一张原图','当天正确原图','预览不可用']);
    assert.equal(await confirmBind.isDisabled(),true);
    await select.selectOption({label:'预览不可用'});
    await picker.getByText('原图加载失败，不能绑定。请关闭后重试。').waitFor();
    assert.equal(await confirmBind.isDisabled(),true);
    await picker.getByRole('button',{name:'取消'}).click();
    assert.deepEqual(await page.evaluate(()=>archiveCalls),[]);
    await bind.click();await select.selectOption({label:'当天正确原图'});
    await picker.getByText('请核对原图上的门店和营业日期，确认后再绑定。').waitFor();
    assert.equal(await confirmBind.isEnabled(),true);
    if(viewport.width<600){const box=await picker.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width);}
    await confirmBind.click();
    await page.waitForFunction(()=>document.getElementById('daily-detail-note').textContent.includes('存档原图已绑定'));
    assert.equal(await page.evaluate(()=>JSON.stringify(state.imports.sheet.cells)===archiveCells),true);
    assert.equal(await page.evaluate(()=>state.imports.sheet.draft.status),'draft');
    assert.equal(await bind.isVisible(),false);
    const bindCalls=await page.evaluate(()=>archiveCalls);
    assert.deepEqual(bindCalls,[{operation:'daily_sheet_attachment_bind_archive',payload:{store:'向里造型',draft_id:'synthetic-bind-draft',
      report_date:await page.evaluate(()=>state.imports.sheet.draft.report_date),request_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      expected_revision:4,confirmed:true}}]);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Daily source actions: mobile/desktop controls, selected-only correction, archive preview/confirmation and readback passed');
}
run().finally(async()=>{if(browser)await browser.close();server.close();}).catch(error=>{console.error(error);process.exitCode=1;});
