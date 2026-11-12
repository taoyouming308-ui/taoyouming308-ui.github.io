/* Original XLSX evidence only. No parser, financial save, confirmation or posting. */
(function (root) {
  'use strict';
  var host = document.getElementById('monthly-source-archive');
  if (!host) return;
  // The employee iframe has a separate, deliberately restricted read contract.
  if (root.StaffReportView && root.StaffReportView.enabled) { host.classList.add('hidden'); return; }
  var MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var scope = null, epoch = 0, bindingEpoch = 0, busy = false, reading = false, listQueued = false, job = null, chosen = null, bindingState = null;
  function el(name) { return host.querySelector('[data-ms-' + name + ']'); }
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function context() { return state.user && state.monthlyOverviewReady===true && !document.getElementById('app').classList.contains('hidden') ? {store:currentStore(),month:document.getElementById('month').value,actor:state.user,key:String(state.user.auth_account_id || state.user.id || state.user.username || '')} : null; }
  function same(ctx) { var now=context();return Boolean(ctx && now && ctx.actor===now.actor && ctx.store===now.store && ctx.month===now.month && ctx.key===now.key); }
  function writable() { return Boolean(scope && same(scope) && state.user.can_upload_reports); }
  function storageKey() { return 'zysyr-monthly-source-v1:'+encodeURIComponent(scope.key)+':'+encodeURIComponent(scope.store); }
  function saveJob() { try { if(job)localStorage.setItem(storageKey(),JSON.stringify(job));else localStorage.removeItem(storageKey()); } catch (_) {} }
  function message(text) { el('status').textContent=text; }
  function wait(promise,ms) { var timer;return Promise.race([promise,new Promise(function(_,reject){timer=setTimeout(function(){reject(Error('等待确认超时'));},ms);})]).finally(function(){clearTimeout(timer);}); }
  function call(op,payload,write) { if(typeof isLocalPreview==='function' && isLocalPreview())return Promise.reject(Error('本地预览不登记真实原件'));return wait(api('monthly_source_archive_'+op,Object.assign({store:scope.store},payload||{}),Boolean(write)),write?300000:60000); }
  function controls() {
    el('form').classList.toggle('hidden',!writable());
    host.querySelectorAll('input,select').forEach(function(input){input.disabled=busy || Boolean(job && job.selection);});
    el('upload').disabled=busy || !writable() || Boolean(job);
    el('select').disabled=busy || !writable() || !bindingState || Boolean(job && job.selection);
    el('query').disabled=busy || !writable() || !job;
    el('resume').disabled=busy || !writable() || !job || Boolean(job.selection) || !chosen;
    el('resume').classList.toggle('hidden',!job || job.status==='archived' || Boolean(job.selection));
    var retryable=Boolean(job && job.selection && job.selection.notFound && !job.selection.definiteConflict);
    var reselectable=Boolean(job && job.selection && job.selection.notFound && job.selection.definiteConflict);
    el('retry-selection').disabled=busy || !writable() || !retryable;
    el('retry-selection').classList.toggle('hidden',!retryable);
    el('reselect').disabled=busy || !writable() || !reselectable;
    el('reselect').classList.toggle('hidden',!reselectable);
    el('new').disabled=busy || Boolean(job && (job.status!=='archived' || job.selection));
  }
  function months(start,end) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(end)||start>end)throw Error('请选择正确的起止月份');
    var out=[],cursor=start;
    while(cursor<=end && out.length<13){out.push(cursor+'-01');var y=Number(cursor.slice(0,4)),m=Number(cursor.slice(5));cursor=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');}
    if(out.length>12)throw Error('一次最多关联十二个月');return out;
  }
  function exactArchive(data,expected) {
    var a=data && data.archive;
    return Boolean(data && data.status==='archived' && a && data.request_id===a.request_id && a.sha256===expected.sha256 && Number(a.size_bytes)===expected.size_bytes && a.mime_type===MIME && Array.isArray(a.worksheet_names) && a.worksheet_names.every(function(n){return typeof n==='string';}));
  }
  function selectionMatches(data,payload) {
    if(!data || data.status!=='selected' || data.selection_request_id!==payload.selection_request_id || data.source_request_id!==payload.source_request_id || data.source_sha256!==payload.expected_source_sha256 || !Array.isArray(data.selections) || data.selections.length!==payload.bindings.length)return false;
    return payload.bindings.every(function(b){var rows=data.selections.filter(function(s){return s.period_month===b.period_month && s.worksheet_name===b.worksheet_name && s.id && Number.isSafeInteger(s.selection_version);});return rows.length===1;});
  }
  host.innerHTML='<div class="finance-record-head"><div><h3>月报核对原件</h3><p class="help">保留完整 Excel，可供多个月份核对；登记原件不调整月报金额。</p></div><button type="button" class="ghost" data-ms-refresh>刷新原件</button></div><div data-ms-current></div><details><summary>已留存的核对原件</summary><div data-ms-list></div><button type="button" class="ghost hidden" data-ms-more>加载更多</button></details><details data-ms-form class="hidden"><summary>登记新版核对原件</summary><div class="form-grid"><div class="field wide"><label>月报 Excel 原件<input data-ms-file type="file" accept=".xlsx,'+MIME+'"></label><small>原件只留存一次，可关联多个工作表月份。旧原件继续保留。</small></div><div class="field"><label>起始月份<input data-ms-start type="month"></label></div><div class="field"><label>截止月份<input data-ms-end type="month"></label></div></div><div class="actions"><button type="button" class="secondary" data-ms-upload>留存原件</button><button type="button" class="ghost" data-ms-query>查询登记结果</button><button type="button" class="ghost hidden" data-ms-resume>恢复原件登记</button><button type="button" class="ghost" data-ms-new>登记另一份原件</button></div><div data-ms-bindings></div><div class="actions"><button type="button" class="primary" data-ms-select disabled>作为所选月份的核对原件</button><button type="button" class="ghost hidden" data-ms-retry-selection>继续原月份关联</button><button type="button" class="ghost hidden" data-ms-reselect>重新选择核对月份</button></div></details><p data-ms-status class="help" role="status" aria-live="polite"></p>';
  var sources=[], offset=0;
  function sourceCard(a,current) {
    return '<div class="finance-record"><strong>'+(current?'新版核对原件：':'')+escape(a.original_filename||'Excel 原件')+'</strong>'+(current?'<p class="help">原件已更新，金额未调整</p>':'')+'<div class="compact-actions"><button type="button" class="ghost" data-ms-open="'+escape(a.request_id)+'">查看原件</button>'+(writable()?'<button type="button" class="ghost" data-ms-use="'+escape(a.request_id)+'">选择核对月份</button>':'')+'</div></div>';
  }
  function bindCards() {
    host.querySelectorAll('[data-ms-open]').forEach(function(button){button.onclick=async function(){var ctx=scope;button.disabled=true;try{var data=await call('url',{source_request_id:button.dataset.msOpen});if(!same(ctx))return;var u=new URL(data.url);if(u.protocol!=='https:')throw Error('原件链接无效');var link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.className='ghost';link.textContent='打开原件';button.replaceWith(link);message('原件已准备好，点击“打开原件”查看。');}catch(e){if(same(ctx))message('原件暂时无法打开：'+e.message);}finally{button.disabled=false;}};});
    host.querySelectorAll('[data-ms-use]').forEach(function(button){button.onclick=async function(){if(busy || !writable())return;if(job && (job.status!=='archived'||job.selection)){message('请先查询尚未确认的登记结果');return;}var a=sources.find(function(s){return s.request_id===button.dataset.msUse;});if(!a || a.status!=='archived')return;job={request_id:a.request_id,status:'archived',archive:a,sha256:a.sha256,size_bytes:Number(a.size_bytes),filename:a.original_filename};saveJob();el('form').open=true;await prepareBindings();};});
  }
  async function listing(append) {
    if(!scope || !same(scope))return;if(reading){listQueued=true;return;}
    var ctx=scope,token=epoch;reading=true;
    try {
      var data=await call('list',{month:ctx.month,offset:append?offset:0});if(!same(ctx)||token!==epoch)return;
      sources=append?sources.concat(data.sources||[]):data.sources||[];offset=Number(data.next_offset)||0;
      el('refresh').textContent='刷新原件';
      el('more').classList.toggle('hidden',!data.has_more);
      el('list').innerHTML=sources.map(function(a){return a.status==='archived'?sourceCard(a,false):'<div class="finance-record"><strong>'+escape(a.original_filename)+'</strong><p class="help">原件登记待确认，请查询结果；需要恢复时重新选择同一份原件。</p><button type="button" class="ghost" data-ms-pending="'+escape(a.request_id)+'">查询这份原件</button></div>';}).join('')||'<div class="empty">当前没有已登记的核对原件。原月报文件仍可从上方原文件入口查看。</div>';
      var selected=data.current_selection,original=selected && sources.find(function(a){return a.request_id===selected.source_request_id;});
      el('current').innerHTML=selected?(original?sourceCard(original,true):sourceCard({request_id:selected.source_request_id,original_filename:'本月新版核对原件'},true)):'<p class="help">本月尚未单独指定新版核对原件。</p>';
      bindCards();host.querySelectorAll('[data-ms-pending]').forEach(function(button){button.onclick=function(){if(busy)return;var a=sources.find(function(s){return s.request_id===button.dataset.msPending;});job={request_id:a.request_id,status:'pending',sha256:a.sha256,size_bytes:Number(a.size_bytes),filename:a.original_filename};chosen=null;saveJob();el('form').open=true;query();};});
    } catch(e){if(same(ctx)&&token===epoch)message('核对原件暂未加载：'+e.message);}finally{reading=false;controls();var queued=listQueued;listQueued=false;if(scope&&queued)listing(false);}
  }
  async function prepareBindings() {
    var bindingToken=++bindingEpoch;bindingState=null;el('bindings').textContent='';controls();
    if(!job || job.status!=='archived' || !job.archive || !writable() || job.selection)return;
    var ctx=scope,token=epoch,archive=job.archive,range;
    try{range=months(el('start').value,el('end').value);}catch(e){message(e.message);return;}
    try {
      var rows=await Promise.all(range.map(async function(month){var data=await call('list',{month:month.slice(0,7),offset:0});return {month:month,previous:data.current_selection?data.current_selection.id:null};}));
      if(!same(ctx)||token!==epoch||bindingToken!==bindingEpoch||!job||job.archive!==archive)return;
      bindingState={archive:archive,rows:rows};el('bindings').innerHTML='<p class="help">请选择各月份在原件中的工作表。登记后原件更新，金额保持原样。</p>'+rows.map(function(row){var number=Number(row.month.slice(5,7)),matches=archive.worksheet_names.filter(function(name){return name.trim()===number+'月';});return '<label style="display:block;margin:10px 0">'+escape(row.month.slice(0,7))+' 工作表<select data-ms-sheet="'+escape(row.month)+'"><option value="">请选择工作表</option>'+archive.worksheet_names.map(function(name){return '<option value="'+escape(name)+'"'+(matches.length===1&&matches[0]===name?' selected':'')+'>'+escape(name)+'</option>';}).join('')+'</select></label>';}).join('');
    } catch(e){if(same(ctx))message('月份关联暂未准备好：'+e.message);}controls();
  }
  async function selectionResult(data,payload,ctx) {
    if(!same(ctx))return;
    if(!selectionMatches(data,payload))throw Error('月份关联结果尚未核实，请查询原登记结果');
    var current=data.selections.every(function(s){return s.is_current===true;});job.selection=null;job.status='archived';saveJob();
    message(current?'原件已更新，金额未调整。旧原件继续保留。':'本次原件关联已保存；部分月份已有后续核对原件，请刷新查看。');el('bindings').textContent='';bindingState=null;await listing(false);
  }
  async function query() {
    if(busy || !writable() || !job)return;busy=true;controls();var ctx=scope,payload=job.selection && job.selection.payload;
    try {
      if(payload){var result=await call('selection_status',{selection_request_id:payload.selection_request_id});if(!same(ctx))return;if(result.selection_request_id!==payload.selection_request_id)throw Error('原月份关联的查询结果尚未匹配');if(result.status==='not_found'){job.selection.notFound=true;saveJob();message(job.selection.definiteConflict?'核对月份的原件已变化，本次关联未保存。可重新选择核对月份，已留存原件保持不变。':'月份关联尚未完成，原件已保留。可继续原月份关联。');}else await selectionResult(result,payload,ctx);}
      else {var data=await call('status',{request_id:job.request_id});if(!same(ctx))return;if(exactArchive(data,job)){job.request_id=data.request_id;job.archive=data.archive;job.status='archived';saveJob();message('原件已留存，请选择核对月份。');await prepareBindings();}else message('原件登记尚未确认。请保留原请求，需要恢复时选择同一份原件。');}
    } catch(e){if(same(ctx))message('登记结果暂未核实：'+e.message);}finally{busy=false;controls();}
  }
  async function sendSelection(payload) {
    if(busy || !writable())return;if(job&&job.selection){job.selection.notFound=false;saveJob();}busy=true;controls();var ctx=scope;
    try{await selectionResult(await call('select',payload,true),payload,ctx);}catch(e){if(same(ctx)){if(/(?:^|[^A-Z_])MONTHLY_SOURCE_SELECTION_CONFLICT(?:$|[^A-Z_])/.test(String(e.message)) && job && job.selection && job.selection.payload.selection_request_id===payload.selection_request_id){job.selection.definiteConflict=true;saveJob();}message('月份关联结果待核对，请查询登记结果。'+e.message);}}finally{busy=false;controls();}
  }
  el('file').onchange=function(){chosen=this.files&&this.files[0]||null;controls();};
  el('start').onchange=el('end').onchange=prepareBindings;
  el('upload').onclick=async function(){
    if(busy||!writable()||job)return;var file=chosen,ctx=scope;
    if(!file||!file.size||file.size>10485760||!/^.+\.xlsx$/i.test(file.name)||(file.type&&file.type!==MIME)){message('请选择不超过 10MB 的 XLSX 原件');return;}
    try{months(el('start').value,el('end').value);}catch(e){message(e.message);return;}
    busy=true;controls();
    try{var bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(n){return n.toString(16).padStart(2,'0');}).join('');if(!same(ctx))return;
      job={request_id:crypto.randomUUID(),status:'pending',filename:file.name,size_bytes:file.size,sha256:hash};saveJob();message('正在留存原件，请等待服务器确认…');
      var encoded=await fileBase64(file);if(!same(ctx))return;var data=await call('upload',{request_id:job.request_id,filename:file.name,mime_type:MIME,base64:encoded},true);if(!same(ctx))return;
      if(!exactArchive(data,job))throw Error('原件完成信息暂未匹配');job.request_id=data.request_id;job.archive=data.archive;job.status='archived';saveJob();message('原件已留存，请选择核对月份。');await prepareBindings();await listing(false);
    }catch(e){if(same(ctx))message(job?'原件登记结果待核对，请查询登记结果，勿重新上传。'+e.message:e.message);}finally{busy=false;controls();}
  };
  el('resume').onclick=async function(){
    if(busy||!writable()||!job||!chosen)return;var ctx=scope,file=chosen;busy=true;controls();
    try{var bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(n){return n.toString(16).padStart(2,'0');}).join('');if(!same(ctx))return;if(file.name!==job.filename||file.size!==job.size_bytes||hash!==job.sha256)throw Error('请选择登记时同一份原件');
      var data=await call('resume',{request_id:job.request_id,filename:file.name,mime_type:MIME,base64:await fileBase64(file)},true);if(!same(ctx))return;if(!exactArchive(data,job))throw Error('原件结果仍待核对');job.request_id=data.request_id;job.archive=data.archive;job.status='archived';saveJob();message('原件已确认留存，请选择核对月份。');await prepareBindings();await listing(false);
    }catch(e){if(same(ctx))message('原件恢复尚未确认：'+e.message);}finally{busy=false;controls();}
  };
  el('select').onclick=function(){
    if(busy||!writable()||!bindingState||!job||job.selection)return;
    var bindings=[],previous={};
    for(var i=0;i<bindingState.rows.length;i++){var row=bindingState.rows[i],select=host.querySelector('[data-ms-sheet="'+row.month+'"]');if(!select.value||job.archive.worksheet_names.indexOf(select.value)<0){message('请逐月选择原件工作表');return;}bindings.push({period_month:row.month,worksheet_name:select.value});previous[row.month]=row.previous;}
    var payload={selection_request_id:crypto.randomUUID(),source_request_id:job.request_id,expected_source_sha256:job.sha256,bindings:bindings,expected_previous_selection_ids:previous,reason:'用户指定新版月报核对原件；保留旧原件，金额未调整'};
    job.selection={payload:payload,notFound:false};saveJob();sendSelection(payload);
  };
  el('retry-selection').onclick=function(){if(job&&job.selection&&job.selection.notFound&&!job.selection.definiteConflict)sendSelection(job.selection.payload);};
  el('reselect').onclick=async function(){if(busy||!writable()||!job||!job.selection||!job.selection.definiteConflict||!job.selection.notFound)return;job.last_selection_conflict=job.selection.payload;job.selection=null;saveJob();message('请重新核对月份和工作表，再确认关联。原件保持不变。');await prepareBindings();};
  el('query').onclick=query;el('refresh').onclick=function(){if(!busy)listing(false);};el('more').onclick=function(){listing(true);};
  el('new').onclick=function(){if(busy || job&&(job.status!=='archived'||job.selection))return;job=null;chosen=null;bindingState=null;saveJob();el('file').value='';el('bindings').textContent='';message('');controls();};
  function sync() {
    var next=context();if(scope && same(scope)){controls();return;}
    epoch++;bindingEpoch++;scope=next;job=null;chosen=null;bindingState=null;sources=[];offset=0;listQueued=false;
    el('current').textContent='';el('list').textContent='';el('bindings').textContent='';el('file').value='';el('form').open=false;message('');
    if(!scope){host.classList.add('hidden');return;}host.classList.remove('hidden');
    el('refresh').textContent='查看核对原件';el('more').classList.add('hidden');
    el('current').textContent='核对原件尚未读取，点击“查看核对原件”可查看本月新版及已留存原件。';
    el('list').textContent='点击“查看核对原件”后加载。原月报文件仍可从上方原文件入口查看。';
    el('start').value=el('end').value=scope.month;
    try{job=JSON.parse(localStorage.getItem(storageKey())||'null');}catch(_){}
    if(job){el('form').open=true;message('上次原件登记已保留，请先查询登记结果。');}
    controls();
  }
  ['store-select','month'].forEach(function(id){document.getElementById(id).addEventListener('change',function(){setTimeout(sync,0);});});
  var originalRender=root.renderAll;if(typeof originalRender==='function')root.renderAll=function(){var result=originalRender.apply(this,arguments);sync();return result;};
  var observer=new MutationObserver(function(){if(!scope || !same(scope))sync();});observer.observe(document.getElementById('app'),{attributes:true,attributeFilter:['class']});
  root.ZysyrMonthlySourceArchive={sync:sync};sync();
})(window);
