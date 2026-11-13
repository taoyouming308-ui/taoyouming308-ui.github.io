/* Manual original-photo archive only. Never creates, recognizes or posts a daily sheet. */
(function (root) {
  'use strict';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ARCHIVE_UPLOAD_WAIT_MS = 300000;
  function validDate(date, month) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month) return false;
    var parsed = new Date(date + 'T00:00:00Z');
    return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }
  function suggestedDate(name, month) {
    var dates = String(name).match(/\d{4}-\d{2}-\d{2}/g) || [];
    return dates.length === 1 && validDate(dates[0], month) ? dates[0] : '';
  }
  function fileError(file) {
    if (file && typeof file.name === 'string' && (file.name !== file.name.trim() || file.name.length > 200)) return '文件名须不超过 200 字符且无首尾空格，请重命名后选择';
    if (!file || !file.size || file.size > MAX_BYTES) return '照片须大于 0 且不超过 10MB';
    if (['image/jpeg', 'image/png'].indexOf(file.type) < 0) return '仅支持 JPG / PNG 原图，请先转换其他格式';
    return '';
  }
  function targetFor(date, context) {
    if (!validDate(date, context.month)) throw Error('请选择本月的有效日期');
    return date;
  }
  function archiveMatches(result, row) {
    var a = result && result.archive;
    return result && result.status === 'archived' && result.request_id === row.requestId && a && a.request_id === row.requestId && a.report_date === row.date && a.sha256 === row.sha256 && a.size_bytes === row.file.size && a.mime_type === row.file.type && a.original_filename === row.file.name;
  }

  function bounded(promise, milliseconds) {
    var timer;
    return Promise.race([promise, new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(Error('等待服务器确认超时')); }, milliseconds);
    })]).finally(function () { clearTimeout(timer); });
  }
  // Dependency-injected runner also supports offline synthetic regression tests.
  async function runBatch(rows, context, deps) {
    var sent = 0;
    function assertScope() { if (!deps.current()) throw Error('已停止：门店、月份、页面或登录状态已变化'); }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], submitted = false;
      if (row.status !== 'pending') continue;
      try {
        assertScope();
        if (!row.confirmed) throw Error('请逐张确认照片对应日期');
        var invalid = fileError(row.file); if (invalid) throw Error(invalid);
        targetFor(row.date, context);
        row.status = 'reading'; deps.update();
        var encoded = await deps.encode(row.file);
        row.sha256 = await deps.hash(row.file);
        assertScope();
        row.requestId = deps.requestId();
        deps.capture(row, context);
        row.status = 'uploading'; deps.update();
        submitted = true;
        var result = await deps.upload({store:context.store,request_id:row.requestId,report_date:row.date,filename:row.file.name,mime_type:row.file.type,base64:encoded,note:'人工逐张核对日期后批量留存原图；不识别、不建表、不入账'});
        if (!archiveMatches(result,row)) throw Error('存档响应尚未确认');
        row.status = 'done'; row.message = '已存档 '+row.date+' · 请求 '+row.requestId; sent++;
        deps.update();
        // A completed in-flight upload is recorded, but cancellation never starts another file.
        assertScope();
      } catch (error) {
        if (row.status !== 'done') {
          row.status = submitted ? 'uncertain' : 'stopped';
          row.message = submitted ? '结果待核对，可能已上传。请刷新存档状态核对，勿直接重传。请求：' + row.requestId + '' : error.message;
        }
        deps.update();
        return {sent:sent, stopped:true, uncertain:submitted && row.status !== 'done'};
      }
    }
    return {sent:sent, stopped:false};
  }
  var exported = {validDate:validDate,suggestedDate:suggestedDate,fileError:fileError,targetFor:targetFor,archiveMatches:archiveMatches,runBatch:runBatch};
  if (typeof module !== 'undefined' && module.exports) { module.exports = exported; return; }
  root.ZysyrDailyBatchUpload = exported;
  var anchor = document.getElementById('daily-open-import');
  if (!anchor) return;
  var entry = document.createElement('button'); entry.type = 'button'; entry.className = 'ghost import-entry';
  entry.id = 'daily-batch-upload'; entry.textContent = '按月批量存档原图'; anchor.after(entry);
  var panel = document.createElement('section'); panel.className = 'form-card hidden'; panel.id = 'daily-batch-panel';
  panel.innerHTML = '<h3>按月存档日报原图</h3><p data-scope></p><p class="help">支持草稿、已入账、锁账和空白日期的 JPG / PNG 原图，每张不超过 10MB。独立存档，不建表、不识别、不修改金额或入账。已入账和锁账日期仅补充原件，不替换原件；空白日期仅存档，尚无日报。文件名日期仅供参考，请逐张看图核对。</p><input type="file" multiple accept="image/jpeg,image/png" aria-label="选择本月日报照片"><button type="button" class="ghost" data-refresh>刷新存档与请求状态</button><label>筛选存档日期（留空看全月）<input type="date" data-filter></label><div data-archives></div><button type="button" class="ghost hidden" data-more>加载更多存档</button><div data-rows></div><div class="actions"><button type="button" class="primary" data-start>确认日期并上传</button><button type="button" class="ghost" data-close>关闭</button></div><p role="status" aria-live="polite" data-status></p>';
  anchor.parentNode.after(panel);
  var picker = panel.querySelector('input[type=file]'), list = panel.querySelector('[data-rows]'), start = panel.querySelector('[data-start]'), close = panel.querySelector('[data-close]'), status = panel.querySelector('[data-status]');
  var rows = [], urls = [], scope = null, busy = false, cancelled = false, used = false, generation = 0;
  var previewViewer;
  function openPreview(url, filename) {
    if (!previewViewer) {
      previewViewer = document.createElement('dialog');
      previewViewer.setAttribute('aria-label','上传前核对日报原图');
      previewViewer.style.cssText = 'width:96vw;max-width:96vw;height:94vh;max-height:94vh;padding:12px;border:1px solid #aaa;border-radius:12px;background:#f5f3ef;color:#222';
      previewViewer.innerHTML = '<div style="display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#f5f3ef;padding:4px;z-index:1"><strong data-label style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong><button type="button" data-turn-left>向左转</button><button type="button" data-zoom-out>缩小</button><button type="button" data-zoom-reset>适合屏幕</button><button type="button" data-zoom-in>放大</button><button type="button" data-turn-right>向右转</button><button type="button" data-close>关闭</button></div><div data-stage style="height:calc(100% - 48px);overflow:auto;text-align:center"><img data-image alt="上传前核对原图" style="height:auto;max-width:none;transform-origin:center"></div>';
      document.body.appendChild(previewViewer);
      previewViewer.querySelector('[data-close]').onclick = function () { previewViewer.close(); };
      previewViewer.addEventListener('click',function(event){if(event.target===previewViewer)previewViewer.close();});
    }
    var image=previewViewer.querySelector('[data-image]'), zoom=1,angle=0;
    function fit(){image.style.width=Math.round(88*zoom)+'vw';image.style.transform='rotate('+angle+'deg)';}
    previewViewer.querySelector('[data-label]').textContent=filename;
    previewViewer.querySelector('[data-zoom-in]').onclick=function(){zoom=Math.min(4,zoom*1.5);fit();};
    previewViewer.querySelector('[data-zoom-out]').onclick=function(){zoom=Math.max(.4,zoom/1.5);fit();};
    previewViewer.querySelector('[data-zoom-reset]').onclick=function(){zoom=1;fit();};
    previewViewer.querySelector('[data-turn-left]').onclick=function(){angle=(angle+270)%360;fit();};
    previewViewer.querySelector('[data-turn-right]').onclick=function(){angle=(angle+90)%360;fit();};
    image.src=url;fit();previewViewer.showModal();
  }
  function permitted() { return state.user && !state.user.personal_scope && state.user.can_import_photo_reports; }
  function sameScope() { return !cancelled && permitted() && scope && scope.generation === generation && scope.store === currentStore() && scope.month === $('month').value && state.view === 'daily-report' && scope.actor === state.user; }
  function revoke() { if(previewViewer&&previewViewer.open)previewViewer.close();urls.forEach(function (url) { URL.revokeObjectURL(url); }); urls = []; }
  function renderStatus() {
    rows.forEach(function (row) {
      var labels = {pending:'待确认',checking:'正在核对日报权限',reading:'正在读取原图',uploading:'正在上传，请勿重复提交',done:'已上传',stopped:'已停止',uncertain:'结果待核对'};
      row.label.textContent = row.message || labels[row.status];
      if (row.status === 'done' && scope && sameScope()) {
        var day = scope.days.find(function (item) { return item.report_date === row.date; });
        if (day && day.draft_id) {
          var view = document.createElement('button'); view.type = 'button'; view.className = 'ghost';
          view.textContent = '在电子日报中查看图片';
          view.onclick = function () {
            if (!sameScope()) return;
            panel.classList.add('hidden');
            openDailyReportDay(row.date,day.draft_id);
          };
          row.label.appendChild(view);
        }
      }
      row.dateInput.disabled = busy || used; row.check.disabled = busy || used;
    });
    picker.disabled = busy || used; start.disabled = busy || used || !rows.length || !sameScope() || rows.some(function (r) { return !r.confirmed || r.status !== 'pending'; });
    close.textContent = busy ? '停止后续上传' : '关闭';
  }
  function stopForChange(event) {
    var privateChange = event || (scope && (scope.actor !== state.user || !permitted() || scope.store !== currentStore() || scope.month !== $('month').value || $('app').classList.contains('hidden') || $('view-daily-report').classList.contains('hidden')));
    generation++;
    if (!scope) return;
    cancelled = true;
    if (privateChange) { panel.classList.add('hidden'); revoke(); list.textContent = ''; if (archiveList) archiveList.textContent = ''; picker.value = ''; rows = []; }
    status.textContent = '已停止后续上传。已发出的请求不能撤回，请核对下方结果；重新选择门店月份后再打开。';
    renderStatus();
  }
  ['store-select','month','daily-month'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change',stopForChange,true); });
  ['daily-month-prev','daily-month-next'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('click',stopForChange,true); });
  // Stop even on away-and-back navigation while a request is pending.
  document.addEventListener('click',function (event) { if (event.target.closest('.nav button, [data-view], #daily-open-import, #user-card button')) stopForChange(); },true);
  window.addEventListener('pagehide',stopForChange);
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function () {
      if (scope && (scope.actor !== state.user || !permitted() || $('app').classList.contains('hidden') || $('view-daily-report').classList.contains('hidden'))) stopForChange();
    });
    [$('app'),$('view-daily-report')].forEach(function (el) { if (el) observer.observe(el,{attributes:true,attributeFilter:['class']}); });
  }
  close.onclick = function () {
    if (busy) { stopForChange(); return; }
    cancelled = true; generation++; revoke(); rows = []; scope = null; picker.value = ''; panel.classList.add('hidden');
  };
  entry.onclick = async function () {
    if (busy) { toast('当前批次仍在等待确认，请先检查下方结果'); return; }
    if (!permitted()) { toast('当前账号没有上传日报原件权限'); return; }
    if (scope && sameScope() && !panel.classList.contains('hidden')) { panel.scrollIntoView({block:'nearest'}); return; }
    var store = currentStore(), month = $('month').value, user = state.user.username, actor = state.user, token = ++generation;
    entry.disabled = true;
    try {
      var data = isLocalPreview() ? previewDailySheetMonth() : await api('daily_sheet_month',{store:store,month:month});
      if (token !== generation || store !== currentStore() || month !== $('month').value || !permitted() || actor !== state.user || user !== state.user.username || state.view !== 'daily-report') return;
      if (data.month !== month) throw Error('月份信息不一致');
      revoke(); rows = []; list.textContent = ''; picker.value = ''; cancelled = false; used = false;
      if (dateFilter && !validDate(dateFilter,month)) { dateFilter = ''; panel.querySelector('[data-filter]').value = ''; }
      scope = {store:store,month:month,user:user,actor:state.user,requests:[],generation:token,days:data.days||[],locked:data.locked};
      panel.querySelector('[data-scope]').textContent = store+' · '+month;
      status.textContent = '一次最多选择 100 张，每张单独确认日期。照片原样上传，不压缩。';
      panel.classList.remove('hidden'); renderStatus(); await refreshArchives(false);
    } catch (error) { toast(error.message); } finally { entry.disabled = false; }
  };
  var archiveList = panel.querySelector('[data-archives]'), more = panel.querySelector('[data-more]'), offset = 0, listing = false, dateFilter = '';
  var selectedArchives = new Set(), voidButton = document.createElement('button');
  voidButton.type='button';voidButton.className='ghost';voidButton.textContent='作废选中原图';voidButton.disabled=true;
  archiveList.after(voidButton);
  voidButton.onclick=async function(){
    if(!sameScope()||busy||!selectedArchives.size)return;
    var ctx=scope,ids=Array.from(selectedArchives),reason=window.prompt('填写作废原因（至少 4 字；原图文件和上传记录保留）','误传到错误门店');
    if(reason===null)return;
    reason=reason.trim();if(reason.length<4||reason.length>500){status.textContent='作废原因需 4–500 字';return;}
    if(!window.confirm('确认在 '+ctx.store+' '+ctx.month+' 作废选中的 '+ids.length+' 张原图？\n作废后不再显示在电子日报，原文件和操作记录保留；不修改金额或入账。'))return;
    busy=true;voidButton.disabled=true;renderStatus();
    try{
      var result=await bounded(api('daily_original_archive_void',{store:ctx.store,request_ids:ids,reason:reason},true),50000);
      if(!sameScope()||scope!==ctx)return;
      status.textContent='已作废 '+result.changed+' / '+ids.length+' 张；原文件和操作记录保留。';selectedArchives.clear();
    }catch(error){if(sameScope())status.textContent='作废结果待核对：'+error.message+'。请刷新列表，不要重复操作。';}
    finally{busy=false;renderStatus();if(sameScope()&&scope===ctx)await refreshArchives(false);}
  };
  function dateLabel(date) {
    var days = scope.days.filter(function (day) { return day.report_date === date; });
    if (!days.length || !days[0].draft_id) return '仅存档，尚无日报';
    return scope.locked || days[0].locked || days[0].status !== 'draft' ? '补充原件，不替换已入账或锁账日报' : '独立存档，对应日期有草稿日报';
  }
  async function refreshArchives(append) {
    if (!sameScope() || listing || isLocalPreview()) return;
    var ctx = scope, token = generation;
    listing = true; more.disabled = true;
    function current() { return scope === ctx && token === generation && sameScope(); }
    try {
      if (!append) { offset = 0; archiveList.textContent = ''; selectedArchives.clear(); voidButton.disabled=true; }
      var data = await bounded(api('daily_original_archive_list',{store:ctx.store,month:ctx.month,offset:offset}),50000);
      if (!current()) return;
      if (!Array.isArray(data.archives)) throw Error('存档列表响应无效');
      data.archives.forEach(function (item) {
        if (item.status === 'pending' || !validDate(item.report_date,ctx.month) || (dateFilter && item.report_date !== dateFilter)) return;
        var line = document.createElement('p');
        line.textContent = item.report_date+' · '+item.original_filename+' · '+(item.status==='voided'?'已作废（保留审计）':'已存档')+' · 日期上下文（非财务绑定）：'+dateLabel(item.report_date)+' · '+(item.created_at || '');
        if(item.status==='voided'){archiveList.appendChild(line);return;}
        var choice=document.createElement('input');choice.type='checkbox';choice.setAttribute('aria-label','选择作废 '+item.report_date+' '+item.original_filename);
        choice.onchange=function(){if(!current())return;if(choice.checked)selectedArchives.add(item.request_id);else selectedArchives.delete(item.request_id);voidButton.disabled=!selectedArchives.size||busy;};
        line.prepend(choice);
        var view = document.createElement('button'); view.type = 'button'; view.textContent = '查看原图（有效期 5 分钟）';
        view.onclick = async function () {
          if (!current()) return;
          view.disabled = true;
          try {
            var link = await bounded(api('daily_original_archive_url',{store:ctx.store,request_id:item.request_id}),50000);
            if (!current()) return;
            if (!link.url || new URL(link.url).protocol !== 'https:') throw Error('原图链接无效');
            var anchor = document.createElement('a'); anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = '打开授权原图（5 分钟内有效）';
            view.replaceWith(anchor);
          } catch (error) { if (current()) { status.textContent = error.message; view.disabled = false; } }
        };
        line.appendChild(view); archiveList.appendChild(line);
      });
      if (!append && !data.archives.length) archiveList.textContent = '本月暂无已完成存档。';
      offset = data.next_offset; more.classList.toggle('hidden',!data.has_more);
      {
        var saved = ctx.requests.slice(), unresolved = [];
        data.archives.filter(function (item) { return item.status === 'pending'; }).forEach(function (item) { if (!saved.some(function (r) { return r.requestId === item.request_id; })) saved.push({requestId:item.request_id,date:item.report_date,sha256:item.sha256,note:item.note,file:{name:item.original_filename,size:item.size_bytes,type:item.mime_type}}); });
        for (var i = 0; i < saved.length; i++) {
          if (!current()) return;
          var row = saved[i], result;
          try { result = await bounded(api('daily_original_archive_status',{store:ctx.store,request_id:row.requestId}),50000); } catch (_) { result = null; }
          if (!current()) return;
          var done = archiveMatches(result,row), text = document.createElement('p');
          text.textContent = row.date+' · '+row.file.name+' · '+(done?'已核对存档成功':'结果待核对，请勿重传')+' · 请求 '+row.requestId;
          archiveList.appendChild(text);
          if (!done) {
            unresolved.push(row);
            (function (savedRow, container) {
              var pick = document.createElement('input'); pick.type = 'file'; pick.accept = 'image/jpeg,image/png'; pick.setAttribute('aria-label','重新选择同一原图以恢复请求 '+savedRow.requestId);
              var resume = document.createElement('button'); resume.type = 'button'; resume.textContent = '核对原文件并恢复此请求';
              resume.onclick = async function () {
                if (!current() || busy) return;
                var file = pick.files && pick.files[0];
                if (!file || fileError(file) || file.name !== savedRow.file.name || file.size !== savedRow.file.size || file.type !== savedRow.file.type) { status.textContent = '须重新选择完全相同的原文件，不能更改日期或请求编号'; return; }
                busy = true; resume.disabled = true; renderStatus();
                try {
                  var hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(function (n) { return n.toString(16).padStart(2,'0'); }).join('');
                  if (hash !== savedRow.sha256) throw Error('文件内容不一致，未恢复请求');
                  if (!current()) return;
                  if (!window.confirm('确认恢复 '+ctx.store+' '+savedRow.date+' 的原图存档？使用原请求编号，不修改财务数据。')) return;
                  var encoded = await bounded(fileBase64(file),45000);
                  if (!current()) return;
                  var result = await bounded(api('daily_original_archive_resume',{store:ctx.store,request_id:savedRow.requestId,report_date:savedRow.date,filename:file.name,mime_type:file.type,base64:encoded,note:savedRow.note || '人工逐张核对日期后批量留存原图；不识别、不建表、不入账'},true),ARCHIVE_UPLOAD_WAIT_MS);
                  if (!current()) return;
                  status.textContent = archiveMatches(result,savedRow) ? '恢复请求已确认存档，请刷新列表' : '恢复结果待核对，请刷新请求状态，勿新建请求重传';
                } catch (error) { if (current()) status.textContent = '恢复尚未确认：'+error.message+'。保留原请求编号，请刷新状态核对。'; }
                finally { busy = false; resume.disabled = false; renderStatus(); }
              };
              container.appendChild(pick); container.appendChild(resume);
            })(row,text);
          }
        }
        ctx.requests = unresolved;
      }
    } catch (error) { if (current()) status.textContent = '存档查询失败：'+error.message+'。未重试上传。'; }
    finally { listing = false; more.disabled = false; }
  }
  panel.querySelector('[data-filter]').onchange = function () { var date = this.value; if (date && !validDate(date,scope.month)) { this.value = dateFilter; return; } dateFilter = date; refreshArchives(false); };
  panel.querySelector('[data-refresh]').onclick = function () { refreshArchives(false); };
  more.onclick = function () { refreshArchives(true); };
  exported.openArchive = function (date) {
    if (!permitted() || busy) return;
    if (typeof dailySheetDirtyCount === 'function' && dailySheetDirtyCount() > 0) { toast('请先保存日报修改，再查看原图存档'); return; }
    if (date && !validDate(date,$('month').value)) { toast('请先切换到对应月份'); return; }
    dateFilter = date || ''; panel.querySelector('[data-filter]').value = dateFilter;
    backToDailyReportCalendar();
    if (scope && sameScope()) refreshArchives(false);
    entry.click();
  };
  picker.onchange = function () {
    if (busy || used || !sameScope()) return;
    revoke(); rows = []; list.textContent = '';
    var files = Array.from(picker.files || []);
    if (files.length > 100) { status.textContent = '一次最多 100 张，请重新选择。'; picker.value = ''; renderStatus(); return; }
    var seen = new Set();
    files.forEach(function (file) {
      var box = document.createElement('div'); box.className = 'finance-record';
      var title = document.createElement('strong'); title.textContent = file.name; title.style.overflowWrap = 'anywhere'; box.appendChild(title);
      var invalid = fileError(file), key = [file.name,file.size,file.lastModified].join('|');
      if (seen.has(key)) invalid = '本批次重复选择，请重新选择文件'; seen.add(key);
      if (!invalid) { var img = document.createElement('img'), url = URL.createObjectURL(file), enlarge=document.createElement('button'); urls.push(url); img.src = url; img.alt = '请核对这张日报的日期'; img.style.cssText = 'display:block;max-width:100%;max-height:240px;margin:8px 0'; enlarge.type='button';enlarge.className='ghost';enlarge.setAttribute('aria-label','放大核对 '+file.name);enlarge.appendChild(img);enlarge.appendChild(document.createTextNode('点击放大核对日期'));enlarge.onclick=function(){openPreview(url,file.name);};box.appendChild(enlarge); }
      var date = document.createElement('input'); date.type = 'date'; date.value = suggestedDate(file.name,scope.month); date.setAttribute('aria-label',file.name+' 对应日报日期');
      date.min = scope.month+'-01'; date.max = scope.month+'-'+new Date(Number(scope.month.slice(0,4)),Number(scope.month.slice(5,7)),0).getDate(); box.appendChild(date);
      var label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; label.appendChild(check); label.appendChild(document.createTextNode('我已看图确认门店和日期')); box.appendChild(label);
      var result = document.createElement('p'); result.className = 'help'; box.appendChild(result); list.appendChild(box);
      var row = {file:file,date:date.value,confirmed:false,status:'pending',message:invalid,label:result,dateInput:date,check:check}; rows.push(row);
      function validate() { row.date = date.value; row.confirmed = false; check.checked = false; try { if (invalid) throw Error(invalid); targetFor(row.date,scope); row.message = '请看图确认日期'; } catch(error) { row.message = error.message; } renderStatus(); }
      date.onchange = validate;
      check.onchange = function () { try { if (invalid) throw Error(invalid); targetFor(date.value,scope); row.confirmed = check.checked; row.message = row.confirmed ? '日期已确认：'+date.value : '请看图确认日期'; } catch(error) { row.confirmed = false; check.checked = false; row.message = error.message; } renderStatus(); };
      validate();
    });
    renderStatus();
  };
  start.onclick = async function () {
    if (busy || used || !sameScope() || !rows.length || rows.some(function (row) { return !row.confirmed; })) return;
    if (isLocalPreview()) { status.textContent = '本地预览不上传真实文件。'; return; }
    if (!window.confirm('确认将 '+rows.length+' 张原图按已核对日期上传到 '+scope.store+' '+scope.month+' 的独立原图存档？\n仅留存原件，不自动识别或入账。')) return;
    busy = true; used = true; renderStatus();
    try {
      var outcome = await runBatch(rows,scope,{
        current:sameScope,update:renderStatus,
        requestId:function () { return crypto.randomUUID(); },
        capture:function (row, ctx) {
          var saved = ctx.requests;
          saved.push({requestId:row.requestId,date:row.date,sha256:row.sha256,file:{name:row.file.name,size:row.file.size,type:row.file.type}});
          ctx.requests = saved;
        },
        hash:async function (file) { var bytes = await file.arrayBuffer(); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function (n) { return n.toString(16).padStart(2,'0'); }).join(''); },
        encode:function (file) { return bounded(fileBase64(file),45000); },
        // retried=true disables even auth-refresh replay for this non-idempotent upload.
        upload:function (payload) { return bounded(api('daily_original_archive_upload',payload,true),ARCHIVE_UPLOAD_WAIT_MS); }
      });
      status.textContent = '已确认上传 '+outcome.sent+' / '+rows.length+' 张。'+(outcome.stopped?'批次已停止，未发送的照片没有上传。请核对每张结果。':'请刷新下方存档列表查看原件。');
      if (outcome.uncertain) status.textContent += '存在结果待核对的上传，未自动重试；请刷新存档状态，勿重传。';
    } finally { busy = false; renderStatus(); if (sameScope()) await refreshArchives(false); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
