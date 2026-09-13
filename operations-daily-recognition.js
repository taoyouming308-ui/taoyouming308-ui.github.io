(function () {
  'use strict';
  var busy = false, batchBusy = false, request = 0;
  function mountRotation(imageId) {
    var img = document.getElementById(imageId);
    if (!img || img.dataset.rotationReady) return;
    img.dataset.rotationReady = '1';
    var stage = img.parentElement, frame = document.createElement('div'), tools = document.createElement('div');
    tools.className = 'compact-actions daily-rotation-tools'; tools.innerHTML = '<button type="button" class="ghost" data-turn="-90">向左转</button><button type="button" class="ghost" data-auto-straighten>自动摆正</button><button type="button" class="ghost" data-turn="90">向右转</button>';
    stage.parentElement.insertBefore(tools,stage); stage.insertBefore(frame,img); frame.appendChild(img);
    frame.className='daily-rotation-frame'; var angle=0,zoom=1,autoDirection=true;
    function normalized(value){return ((value%360)+360)%360;}
    function automaticAngle(){return img.naturalHeight>img.naturalWidth?90:0;}
    function fit(recenter) {
      if (!img.naturalWidth) return;
      if(autoDirection)angle=automaticAngle();
      var swapped=normalized(angle)%180===90,rotatedWidth=swapped?img.naturalHeight:img.naturalWidth,rotatedHeight=swapped?img.naturalWidth:img.naturalHeight;
      var availableWidth=Math.max(240,stage.clientWidth-28),availableHeight=Math.max(260,Math.min(window.innerHeight*.68,720));
      var scale=Math.min(1,availableWidth/rotatedWidth,availableHeight/rotatedHeight)*zoom;
      var w=img.naturalWidth*scale,h=img.naturalHeight*scale;
      frame.style.width=(rotatedWidth*scale)+'px';frame.style.height=(rotatedHeight*scale)+'px';
      Object.assign(img.style,{position:'absolute',maxWidth:'none',width:w+'px',height:h+'px',left:'50%',top:'50%',transform:'translate(-50%,-50%) rotate('+angle+'deg)'});
      tools.hidden=!img.getAttribute('src');
      if(recenter)requestAnimationFrame(function(){stage.scrollLeft=Math.max(0,(stage.scrollWidth-stage.clientWidth)/2);stage.scrollTop=0;});
    }
    tools.querySelectorAll('[data-turn]').forEach(function(button){button.onclick=function(){autoDirection=false;angle=normalized(angle+Number(button.dataset.turn));fit(true);};});
    tools.querySelector('[data-auto-straighten]').onclick=function(){autoDirection=true;zoom=1;fit(true);};
    img.__setRotationZoom=function(value){zoom=Math.max(.6,Math.min(2.4,Number(value)||1));fit(true);};
    img.addEventListener('load',function(){autoDirection=true;zoom=1;fit(true);});window.addEventListener('resize',function(){fit(false);});
    new MutationObserver(function(){autoDirection=true;angle=0;zoom=1;if(img.complete)fit(true);}).observe(img,{attributes:true,attributeFilter:['src']});if(img.complete)fit(true);
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
      var filled=Number(result.saved&&result.saved.saved_cells||0),textFilled=Number(result.saved&&result.saved.saved_text_cells||0),nameFilled=Number(result.saved&&result.saved.saved_row_names||0),skipped=Number(result.saved&&result.saved.manual_cells_preserved||0),uncertain=[].concat(result.cells||[],result.text_cells||[],result.row_names||[]).filter(function(row){return Number(row.confidence)<.85;}).length;
      state.imports.sheet=result.sheet;state.imports.dirty={};state.imports.dirtyLabels={};renderDailySheetDetail();
      status.hidden=false;
      document.getElementById('daily-detail-reviewed').checked=false;
      document.getElementById('daily-detail-reason').value='对照日报原图核对图片识别草稿';
      renderDailyDetailControls();status.textContent='识别草稿已保存：数字 '+filled+' 格、姓名 '+nameFilled+' 行、文字 '+textFilled+' 格；保留财务已填 '+skipped+' 项；'+uncertain+' 项识别不确定。黄色内容请对照原图核对，最终确认后才入账。'+(result.date_unconfirmed?' 原图日期未识别，请核对。':'')+(result.store_unconfirmed?' 原图门店未识别，请核对。':'')+(result.warnings||[]).join('；');
    }catch(error){if(generation===request){status.hidden=false;status.textContent=error.message+'；原图已留底，电子数据未被自动覆盖。';}}
    finally{busy=false;button.disabled=false;}
  };
  button.onclick=function(){window.recognizeCurrentDaily();};

  var monthBar=document.querySelector('#view-daily-report>.daily-month-bar');
  var batch=document.createElement('button');batch.type='button';batch.className='secondary';batch.id='daily-recognize-month';batch.textContent='Codex识别本月原图';monthBar.appendChild(batch);
  var batchStatus=document.createElement('span');batchStatus.id='daily-recognize-month-status';batchStatus.className='help';monthBar.appendChild(batchStatus);
  var jobPanel=document.createElement('section');jobPanel.id='daily-recognition-job';jobPanel.className='daily-recognition-job hidden';monthBar.after(jobPanel);
  var currentJob=null,jobKey='',runToken=0,restoreTimer=0;
  function selectedMonth(){return document.getElementById('daily-month').value||currentMonthInput();}
  function currentJobKey(){return currentStore()+'|'+selectedMonth();}
  function jobStatusText(value){return {pending:'准备中',running:'识别中',paused:'已暂停',completed:'已完成',completed_with_errors:'部分失败'}[value]||value||'未开始';}
  async function retryRecognitionItem(job,item,control){
    if(control){control.disabled=true;control.textContent='正在重新识别…';}
    try{var result=await api('daily_recognition_item_retry',{store:currentStore(),month:selectedMonth(),job_id:job.id,item_id:item.id});batchStatus.textContent=item.report_date+' 已加入单日重新识别；财务手工修改会保留';renderJob(result);runJob(result);}catch(error){toast(error.message);if(control){control.disabled=false;control.textContent='重新识别';}}
  }
  function renderJob(data){
    currentJob=data&&data.job?data:null;
    if(!currentJob){jobPanel.classList.add('hidden');return;}
    var job=data.job,items=data.items||[],done=Number(data.completed_count||0),total=Number(job.total_count||0),remaining=Number(data.remaining_count||0);
    var list=items.map(function(item){
      var label={queued:'等待',running:'正在识别',succeeded:'待财务核对',failed:'失败',skipped:'已跳过'}[item.status]||item.status;
      var completed=item.status==='succeeded'||item.status==='failed',canRerun=completed&&item.draft_status==='draft'&&Number(item.attempt_count||0)<10;
      var action=item.status==='succeeded'?'data-recognition-review="'+esc(item.id)+'"':item.status==='failed'?'data-recognition-failure="'+esc(item.id)+'"':'';
      var detail=item.status==='succeeded'?esc(item.candidate_count)+' 项候选 · 点击核对':item.status==='failed'?'点击查看失败原因':esc(item.error_message||'');
      var main=completed?'<button type="button" class="daily-recognition-main" '+action+'><span>'+esc(item.report_date)+'</span><strong>'+esc(label)+'</strong><span>'+detail+'</span></button>':'<div class="daily-recognition-main"><span>'+esc(item.report_date)+'</span><strong>'+esc(label)+'</strong><span>'+detail+'</span></div>';
      var rerun=canRerun?'<button type="button" class="ghost daily-recognition-rerun" data-recognition-rerun="'+esc(item.id)+'">重新识别</button>':completed&&item.draft_status!=='draft'?'<span class="help">已确认</span>':completed?'<span class="help">已达上限</span>':'';
      return '<div class="daily-recognition-item '+esc(item.status)+'">'+main+rerun+'</div>';
    }).join('');
    var actions='';
    if(data.permissions&&data.permissions.write){
      if(job.status==='running'||job.status==='pending')actions='<button type="button" class="ghost" data-job-action="pause">暂停</button>';
      else if(job.status==='paused')actions='<button type="button" class="secondary" data-job-action="resume">继续识别</button>';
      else if(job.status==='completed_with_errors')actions='<button type="button" class="secondary" data-job-action="retry_failed">重试失败日期</button>';
    }
    jobPanel.classList.remove('hidden');jobPanel.innerHTML='<div class="finance-record-head"><div><strong>本月日报识别进度：'+esc(jobStatusText(job.status))+'</strong><div class="help">已处理 '+done+'/'+total+' 天 · 成功 '+esc(job.success_count)+' 天 · 失败 '+esc(job.failed_count)+' 天 · 剩余 '+remaining+' 天'+(job.current_report_date?' · 当前 '+esc(job.current_report_date):'')+'</div></div><div class="compact-actions">'+actions+'</div></div><progress max="'+Math.max(total,1)+'" value="'+done+'"></progress><div class="daily-recognition-items">'+list+'</div><div id="daily-recognition-failure-detail" class="daily-recognition-failure-detail hidden"></div><div class="help">成功和失败日期都可单独重新识别；财务手工修改不会被覆盖。绿色日期可进入当天日报核对，红色日期可查看失败原因。退出本页后进度仍会保存；所有机器结果只是待核对草稿，不会自动入账。</div>';
    jobPanel.querySelectorAll('[data-job-action]').forEach(function(control){control.onclick=async function(){control.disabled=true;try{var result=await api('daily_recognition_job_control',{store:currentStore(),month:selectedMonth(),job_id:job.id,action:control.dataset.jobAction});renderJob(result);if(control.dataset.jobAction!=='pause')runJob(result);}catch(error){toast(error.message)}finally{control.disabled=false;}};});
    jobPanel.querySelectorAll('[data-recognition-review]').forEach(function(control){control.onclick=function(){var item=items.find(function(row){return row.id===control.dataset.recognitionReview;});if(item)openDailyReportDay(item.report_date,item.draft_id,'',false);};});
    jobPanel.querySelectorAll('[data-recognition-failure]').forEach(function(control){control.onclick=function(){
      var item=items.find(function(row){return row.id===control.dataset.recognitionFailure;}),detail=jobPanel.querySelector('#daily-recognition-failure-detail');if(!item||!detail)return;
      detail.classList.remove('hidden');detail.innerHTML='<div><strong>'+esc(item.report_date)+' 识别失败</strong><div class="help">失败原因：'+esc(item.error_message||'识别服务未返回有效结果')+'</div><div class="help">已尝试 '+esc(item.attempt_count||0)+' 次；重新识别只处理这一天，不会重复处理其他日期。</div></div>';
      detail.scrollIntoView({behavior:'smooth',block:'nearest'});
    };});
    jobPanel.querySelectorAll('[data-recognition-rerun]').forEach(function(control){control.onclick=function(){var item=items.find(function(row){return row.id===control.dataset.recognitionRerun;});if(item)retryRecognitionItem(job,item,control);};});
  }
  function stillOnJob(key){return state.view==='daily-report'&&currentJobKey()===key;}
  async function runJob(data){
    if(batchBusy||!data||!data.job||!['running','pending'].includes(data.job.status))return;
    var key=currentJobKey(),token=++runToken;batchBusy=true;batch.disabled=true;
    try{
      while(stillOnJob(key)&&token===runToken&&currentJob&&currentJob.job&&['running','pending'].includes(currentJob.job.status)){
        var result=await api('daily_recognition_job_next',{store:currentStore(),month:selectedMonth(),job_id:currentJob.job.id});
        if(token!==runToken)break;renderJob(result);
        if(result.item_result){batchStatus.textContent=result.item_result.report_date+(result.item_result.succeeded?' 已保存待核对候选 '+result.item_result.candidate_count+' 项':' 识别失败：'+result.item_result.error);}
        if(!result.item_result&&Number(result.remaining_count||0)>0)await new Promise(function(resolve){setTimeout(resolve,4000);});
      }
      if(stillOnJob(key)&&currentJob&&currentJob.job&&!['running','pending'].includes(currentJob.job.status)){await loadDailyReportOverview();batchStatus.textContent=currentJob.job.status==='completed'?'本月识别完成，请财务逐日核对并最终确认':'本月识别完成，但有失败日期，请查看并重试';}
    }catch(error){batchStatus.textContent=error.message;toast(error.message);}
    finally{batchBusy=false;batch.disabled=false;if(state.view==='daily-report'&&currentJob&&currentJob.job&&['running','pending'].includes(currentJob.job.status))setTimeout(function(){runJob(currentJob);},0);}
  }
  async function restoreJob(){
    if(isLocalPreview()||state.view!=='daily-report')return;
    var key=currentJobKey();jobKey=key;
    try{var result=await api('daily_recognition_job_read',{store:currentStore(),month:selectedMonth()});if(jobKey!==key)return;renderJob(result);if(result.job&&['running','pending'].includes(result.job.status))runJob(result);}catch(error){batchStatus.textContent='进度读取失败：'+error.message;}
  }
  batch.onclick=async function(){
    if(batchBusy||isLocalPreview())return;
    var month=state.dailyReportMonth||{},targets=(month.days||[]).filter(function(day){return day.status==='draft'&&day.draft_id&&Number(day.approved_original_count||0)>0;});
    if(!targets.length){toast('本月没有可识别的日报原图');return;}
    if(!window.confirm('将按日期识别 '+targets.length+' 天原图，姓名、数字和备注只保存为待核对草稿，不会自动入账。继续吗？'))return;
    batch.disabled=true;
    try{var result=await api('daily_recognition_job_start',{store:currentStore(),month:selectedMonth()});renderJob(result);runJob(result);}catch(error){batchStatus.textContent=error.message;toast(error.message);batch.disabled=false;}
  };
  var calendarBase=renderDailyReportCalendar;
  renderDailyReportCalendar=function(data){calendarBase(data);var r=data.recognition||{};batch.hidden=!(data.permissions&&data.permissions.write);batchStatus.textContent=r.eligible_days==null?'':'识别草稿 '+r.recognized_days+'/'+r.eligible_days+' 天，待识别 '+r.pending_days+' 天';clearTimeout(restoreTimer);restoreTimer=setTimeout(restoreJob,50);};
})();
