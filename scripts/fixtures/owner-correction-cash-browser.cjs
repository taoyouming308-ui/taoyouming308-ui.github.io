const assert=require('node:assert/strict');
module.exports=async function(page){
 await page.evaluate(()=>{
  calculateDailyControls=syntheticOriginalControls;state.user.role='shareholder';state.user.can_correct_confirmed_daily=true;
  const s=previewDailySheetData();s.draft={...s.draft,id:'synthetic-cash-draft',report_date:'2026-10-09',status:'confirmed',edit_revision:5,
   template_code:'zysyr_frontdesk_project_draft',ocr_raw_result:{autofill:{cash_receipts:{policy:'operating-external-cash-v1',state:'candidate',cash_channels_complete:false},daily_total_policy:'cash-plus-earned-card-v1'}}};
  s.permissions={write:false,correct_confirmed:true};s.locked=false;s.attachments=[];s.history=[];
  s.cash_review={status:'current',revision:5,original_ready:true,source_token:'a'.repeat(64)};
  window.cashFixture=structuredClone(s);state.imports.sheet=structuredClone(s);state.imports.dirty={};state.imports.dirtyLabels={};
  window.cashCalls=[];window.cashDialogs=[];window.cashAccepted=false;window.cashMissing=false;window.cashStale=false;window.cashReadHold=false;
  window.confirm=text=>{cashDialogs.push(text);return cashAccepted;};
  api=async(op,p)=>{
   cashCalls.push({op,p});
   if(op==='daily_recognition_job_read')return {job:null};
   if(op==='daily_sheet_read'){
    if(cashReadHold)await new Promise(r=>window.cashReleaseRead=r);
    const read=structuredClone(cashFixture);if(cashMissing)read.cash_review.original_ready=false;if(cashStale)read.draft.edit_revision++;
    return read;
   }
   if(op==='daily_sheet_correct'){
    for(const [i,c] of p.cells.entries()){
     let target=c.id&&cashFixture.cells.find(x=>x.id===c.id);
     if(!target){target={id:'synthetic-new-'+i,section_code:c.section_code,row_key:c.row_key,column_code:c.column_code,cell_role:c.cell_role,row_number:c.row_number,column_number:c.column_number};cashFixture.cells.push(target);}
     if(Object.hasOwn(c,'value')){target.manual_override=true;target.corrected_numeric=c.value==null?null:Number(c.value);}
     if(c.row_label_reviewed)target.row_label=c.row_label;
    }
    cashFixture.draft.edit_revision=6;cashFixture.cash_review.revision=6;
    return {corrected:true,saved:{request_id:p.request_id,cash_source_reviewed:true}};
   }
   if(op==='daily_sheet_month')return {month:'2026-10',days:[{report_date:'2026-10-09',draft_id:cashFixture.draft.id,status:'confirmed',grand_total:100,edit_revision:6}]};
   if(op==='daily_sheet_correction_status')return {applied:false};
   throw Error('Unexpected cash fixture operation '+op);
  };
  renderDailySheetDetail();
 });
 await page.locator('#daily-correction-start').click();
 await page.evaluate(()=>{
  const root=document.getElementById('daily-detail-grid'),inputs=[...root.querySelectorAll('[data-daily-cell],[data-new-cell]')];
  const atomic=inputs.find(n=>n.dataset.role==='staff_value');
  for(const n of inputs){if(['signature','unclosed_order','note'].includes(n.dataset.role))continue;n.value='0';}
  atomic.value='100';inputs.find(n=>n.dataset.role==='staff_total'&&n.dataset.rowKey===atomic.dataset.rowKey).value='100';
  inputs.find(n=>n.dataset.role==='category_total'&&n.dataset.columnCode===atomic.dataset.columnCode).value='100';
  inputs.find(n=>n.dataset.section==='stylist'&&n.dataset.rowKey==='stylist_category_total'&&n.dataset.columnCode==='subtotal').value='100';
  for(const role of ['summary_actual','summary_grand','payment_cashflow','payment_total'])inputs.find(n=>n.dataset.role===role).value='100';
  inputs.find(n=>n.dataset.role==='payment_method').value='100';
  for(const n of inputs){if(['signature','unclosed_order','note'].includes(n.dataset.role))continue;n.dispatchEvent(new Event('input',{bubbles:true}));}
 });
 await page.locator('#daily-detail-reason').fill('Synthetic balanced correction');
 const before=await page.evaluate(()=>JSON.stringify({dirty:state.imports.dirty,labels:state.imports.dirtyLabels,values:[...document.querySelectorAll('#daily-detail-grid input')].map(n=>n.value),reason:document.getElementById('daily-detail-reason').value}));
 const c=await page.evaluate(()=>{const c=calculateDailyControls(document.getElementById('daily-detail-grid'));return {numericValid:c.numericValid,valid:c.valid,sourceMissing:c.sourceMissing};});
 assert.deepEqual(c,{numericValid:true,valid:false,sourceMissing:true},'original deadlock reproduced using the actual renderer and calculator');
 await page.evaluate(()=>cashMissing=true);await page.locator('#daily-correction-submit').click();
 assert.match(await page.locator('#daily-correction-status').textContent(),/来源核实信息/);assert.equal(await page.evaluate(()=>cashDialogs.length),0);
 await page.evaluate(()=>{cashMissing=false;cashStale=true;});await page.locator('#daily-correction-submit').click();
 assert.match(await page.locator('#daily-correction-status').textContent(),/版本、权限或锁账/);assert.equal(await page.evaluate(()=>cashDialogs.length),0);
 await page.evaluate(()=>{cashStale=false;cashReadHold=true;});
 await page.locator('#daily-correction-submit').click();await page.waitForFunction(()=>typeof cashReleaseRead==='function');
 assert.equal(await page.locator('#daily-correction-submit').isDisabled(),true,'repeated clicks during proof refresh cannot produce duplicate dialogs');
 await page.evaluate(()=>{cashReadHold=false;cashReleaseRead();});await page.waitForFunction(()=>cashDialogs.length===1);
 assert.equal(await page.evaluate(()=>cashCalls.filter(x=>x.op==='daily_sheet_correct').length),0,'cancelled single confirmation produces no correction or attestation');
 assert.equal(await page.evaluate(()=>JSON.stringify({dirty:state.imports.dirty,labels:state.imports.dirtyLabels,values:[...document.querySelectorAll('#daily-detail-grid input')].map(n=>n.value),reason:document.getElementById('daily-detail-reason').value})),before,'read-only context refresh and cancellation preserve every pending field');
 await page.evaluate(()=>cashAccepted=true);await page.locator('#daily-correction-submit').click();
 await page.waitForFunction(()=>state.imports.sheet.draft.edit_revision===6&&!ZysyrDailyCorrection.protectedInput());
 const calls=await page.evaluate(()=>cashCalls.filter(x=>x.op==='daily_sheet_correct'));assert.equal(calls.length,1);
 assert.deepEqual(calls[0].p.cash_source_confirmation,{statement:'owner-confirmed-cash-review-v1',source_token:'a'.repeat(64),reviewed_original:true,reviewed_channels:true,reviewed_card_sales:true});
 assert.match(await page.evaluate(()=>cashDialogs.at(-1)),/全部金额、收款渠道和充值售卡实收/);
 assert.equal(await page.evaluate(()=>cashCalls.some(x=>['daily_sheet_save','daily_sheet_confirm','daily_sheet_cash_review'].includes(x.op))),false);
 assert.equal(await page.locator('#daily-correction-actions input[type=checkbox]').count(),0,'no extra checklist or page');
 console.log('Cash correction browser: actual balanced/source-missing deadlock, fresh read without adoption, one explicit confirmation, cancellation, no retyping, double-click guard and committed-only adoption passed.');
};
