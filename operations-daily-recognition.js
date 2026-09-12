(function () {
  'use strict';
  var busy = false, batchBusy = false, request = 0;
  function mountRotation(imageId) {
    var img = document.getElementById(imageId);
    if (!img || img.dataset.rotationReady) return;
    img.dataset.rotationReady = '1';
    var stage = img.parentElement, frame = document.createElement('div'), tools = document.createElement('div');
    tools.className = 'compact-actions'; tools.innerHTML = '<button type="button" class="ghost" data-turn="-90">向左旋转</button><button type="button" class="ghost" data-turn="90">向右旋转</button><button type="button" class="ghost" data-turn="0">恢复方向</button>';
    stage.parentElement.insertBefore(tools,stage); stage.insertBefore(frame,img); frame.appendChild(img);
    frame.style.position='relative'; var angle=0;
    function fit() {
      if (!img.naturalWidth) return;
      var swapped=Math.abs(angle%180)===90, width=Math.max(240,stage.clientWidth-20);
      var scale=Math.min(1,width/(swapped?img.naturalHeight:img.naturalWidth));
      var w=img.naturalWidth*scale,h=img.naturalHeight*scale;
      frame.style.width=(swapped?h:w)+'px';frame.style.height=(swapped?w:h)+'px';
      Object.assign(img.style,{position:'absolute',maxWidth:'none',width:w+'px',height:h+'px',left:'50%',top:'50%',transform:'translate(-50%,-50%) rotate('+angle+'deg)'});
      tools.hidden=!img.getAttribute('src');
    }
    tools.querySelectorAll('[data-turn]').forEach(function(button){button.onclick=function(){angle=Number(button.dataset.turn)===0?0:(angle+Number(button.dataset.turn))%360;fit();};});
    img.addEventListener('load',fit);window.addEventListener('resize',fit);
    new MutationObserver(function(){angle=0;fit();}).observe(img,{attributes:true,attributeFilter:['src']});fit();
  }
  mountRotation('daily-detail-image');mountRotation('daily-original-image');
  var monthlyBase=renderMonthlyAuditControls;
  renderMonthlyAuditControls=function(){monthlyBase();var report=state.data.monthly_report,cell=report&&(report.display_data.cells||[]).find(function(row){return row.daily_rollup;});if(!cell)return;var box=document.createElement('div');box.className='candidate-warning';box.textContent='主营收入来自已确认日报 '+cell.daily_rollup.confirmed_days+' 天：'+formatAmount(cell.daily_rollup.amount)+'；原月报：'+formatAmount(cell.original_report_amount)+'。请核对日报是否录齐，点击收入可查看具体日期。';document.getElementById('report-state').appendChild(box);};
  var upload=document.getElementById('daily-detail-upload');
  var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Codex识别原图';button.id='daily-recognize';upload.after(button);
  var status=document.createElement('div');status.id='daily-recognition-status';status.className='candidate-warning';status.hidden=true;document.getElementById('daily-detail-grid').before(status);
  var renderBase=renderDailySheetDetail;
  renderDailySheetDetail=function(){request++;renderBase();var sheet=state.imports.sheet;button.hidden=!(sheet&&sheet.permissions&&sheet.permissions.write&&sheet.draft.status==='draft'&&!sheet.locked);status.hidden=true;};
  window.recognizeCurrentDaily=async function(voucherId){
    var sheet=state.imports.sheet;if(busy||!sheet||sheet.draft.status!=='draft'||sheet.locked)return;
    if(dailySheetDirtyCount()){toast('请先保存当前修改，再识别原图');return;}
    var items=(sheet.attachments||[]).filter(function(item){return item.attachment_kind==='original_report'&&['image/jpeg','image/png'].includes(item.mime_type);});
    var item=voucherId?items.find(function(row){return (row.voucher_id||row.id)===voucherId;}):items.find(function(row){return row.private_url===document.getElementById('daily-detail-image').getAttribute('src');})||items[0];
    if(!item){toast('请先上传或选中当天 JPG/PNG 日报原图');return;}
    var generation=++request,store=currentStore(),draftId=sheet.draft.id;
    busy=true;button.disabled=true;status.hidden=false;status.textContent='Codex正在识别，请稍候。原有数字会保留，识别只填空白格。';
    try{
      if(isLocalPreview())throw Error('本地预览不调用付费识别服务');
      var result=await api('daily_sheet_recognize',{store:store,draft_id:draftId,voucher_id:item.voucher_id||item.id});
      if(generation!==request||currentStore()!==store||state.imports.sheet.draft.id!==draftId)return;
      if(dailySheetDirtyCount()){status.textContent='识别期间有手工修改，本次结果未填入；请保存后重试。';return;}
      var filled=Number(result.saved&&result.saved.saved_cells||0),skipped=Number(result.saved&&result.saved.manual_cells_preserved||0),uncertain=(result.cells||[]).filter(function(row){return Number(row.confidence)<.85;}).length;
      state.imports.sheet=result.sheet;state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
      status.hidden=false;
      document.getElementById('daily-detail-reviewed').checked=false;
      document.getElementById('daily-detail-reason').value='对照日报原图核对图片识别草稿';
      renderDailyDetailControls();status.textContent='识别草稿已保存 '+filled+' 格；保留财务已填 '+skipped+' 格；'+uncertain+' 格识别不确定。黄色数字请对照原图核对，最终确认后才入账。'+(result.date_unconfirmed?' 原图日期未识别，请核对。':'')+(result.store_unconfirmed?' 原图门店未识别，请核对。':'')+(result.warnings||[]).join('；');
    }catch(error){if(generation===request){status.hidden=false;status.textContent=error.message+'；原图已留底，电子数据未被自动覆盖。';}}
    finally{busy=false;button.disabled=false;}
  };
  button.onclick=function(){window.recognizeCurrentDaily();};

  var monthBar=document.querySelector('#view-daily-report>.daily-month-bar');
  var batch=document.createElement('button');batch.type='button';batch.className='secondary';batch.id='daily-recognize-month';batch.textContent='Codex识别本月原图';monthBar.appendChild(batch);
  var batchStatus=document.createElement('span');batchStatus.id='daily-recognize-month-status';batchStatus.className='help';monthBar.appendChild(batchStatus);
  async function recognizeDraft(day){
    var sheet=await api('daily_sheet_read',{store:currentStore(),draft_id:day.draft_id});
    var item=(sheet.attachments||[]).find(function(row){return row.attachment_kind==='original_report'&&['image/jpeg','image/png'].includes(row.mime_type);});
    if(!item)throw Error('没有可识别的 JPG/PNG 原图');
    return api('daily_sheet_recognize',{store:currentStore(),draft_id:day.draft_id,voucher_id:item.voucher_id||item.id});
  }
  batch.onclick=async function(){
    if(batchBusy||isLocalPreview())return;
    var month=state.dailyReportMonth||{},targets=(month.days||[]).filter(function(day){return day.status==='draft'&&day.draft_id&&Number(day.approved_original_count||0)>0&&!day.recognition_saved;});
    if(!targets.length){toast('本月没有待识别的日报原图');return;}
    if(!window.confirm('将识别 '+targets.length+' 天原图并保存为待核对草稿，不会自动正式确认。继续吗？'))return;
    batchBusy=true;batch.disabled=true;var ok=0,failed=[];
    try{
      for(var i=0;i<targets.length;i++){
        batchStatus.textContent='正在识别 '+(i+1)+'/'+targets.length+'：'+targets[i].report_date;
        try{await recognizeDraft(targets[i]);ok++;}catch(error){failed.push(targets[i].report_date+'：'+error.message);}
      }
      await loadDailyReportOverview();batchStatus.textContent='已保存待核对草稿 '+ok+' 天'+(failed.length?'，失败 '+failed.length+' 天':'，全部完成');
      if(failed.length)toast('部分日报识别失败，可稍后重试：'+failed.slice(0,3).join('；'));
      else toast('本月日报识别草稿已保存，请财务逐日核对后最终确认');
    }finally{batchBusy=false;batch.disabled=false;}
  };
  var calendarBase=renderDailyReportCalendar;
  renderDailyReportCalendar=function(data){calendarBase(data);var r=data.recognition||{};batch.hidden=!(data.permissions&&data.permissions.write);batchStatus.textContent=r.eligible_days==null?'':'识别草稿 '+r.recognized_days+'/'+r.eligible_days+' 天，待识别 '+r.pending_days+' 天';};
})();
