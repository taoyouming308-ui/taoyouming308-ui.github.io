(function () {
  'use strict';
  var busy = false, request = 0;
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
  var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='识别原图填入电子日报';button.id='daily-recognize';upload.after(button);
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
    busy=true;button.disabled=true;status.hidden=false;status.textContent='正在识别，请稍候。原有数字会保留，识别只填空白格。';
    try{
      if(isLocalPreview())throw Error('本地预览不调用付费识别服务');
      var result=await api('daily_sheet_recognize',{store:store,draft_id:draftId,voucher_id:item.voucher_id||item.id});
      if(generation!==request||currentStore()!==store||state.imports.sheet.draft.id!==draftId)return;
      if(dailySheetDirtyCount()){status.textContent='识别期间有手工修改，本次结果未填入；请保存后重试。';return;}
      var filled=0,skipped=0,uncertain=0,byId=new Map((result.cells||[]).map(function(row){return [row.id,row];}));
      document.querySelectorAll('#daily-detail-grid [data-daily-cell]').forEach(function(input){var row=byId.get(input.dataset.dailyCell);if(!row)return;if(input.value!==''){skipped++;return;}input.value=String(row.value);input.dispatchEvent(new Event('input',{bubbles:true}));input.style.background=row.confidence<.85?'#ffe1ba':'#fff5c2';input.title='识别候选，请对照原图核对';filled++;if(row.confidence<.85)uncertain++;});
      document.getElementById('daily-detail-reviewed').checked=false;
      document.getElementById('daily-detail-reason').value='核对原图识别草稿 '+result.audit_id;
      renderDailyDetailControls();status.textContent='已填入 '+filled+' 格；保留已有 '+skipped+' 格；'+uncertain+' 格识别不确定。请对照原图核对、修改并保存，最终确认后才入账。'+(result.date_unconfirmed?' 原图日期未识别，请核对。':'')+(result.store_unconfirmed?' 原图门店未识别，请核对。':'')+(result.warnings||[]).join('；');
    }catch(error){if(generation===request){status.hidden=false;status.textContent=error.message+'；原图已留底，电子数据未被自动覆盖。';}}
    finally{busy=false;button.disabled=false;}
  };
  button.onclick=function(){window.recognizeCurrentDaily();};
})();
