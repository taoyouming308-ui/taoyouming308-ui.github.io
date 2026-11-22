/* Manual original-photo archive only. Never creates, recognizes or posts a daily sheet. */
(function (root) {
  'use strict';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ARCHIVE_UPLOAD_WAIT_MS = 300000;
  var DEFAULT_ARCHIVE_NOTE = '人工逐张核对日期后批量留存原图；不识别、不建表、不入账';
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
  function validateSourceStore(sourceStore, destination) {
    if (!sourceStore) throw Error('请先选择原图实际所属门店');
    if (sourceStore !== destination) throw Error('原图属于「' + sourceStore + '」，当前档案为「' + destination + '」。请切换到原图所属门店再上传。');
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
        validateSourceStore(row.sourceStore, context.store);
        if (!row.confirmed) throw Error('请逐张核对原图的门店和日期');
        var invalid = fileError(row.file); if (invalid) throw Error(invalid);
        targetFor(row.date, context);
        row.status = 'reading'; deps.update();
        var encoded = await deps.encode(row.file);
        row.sha256 = await deps.hash(row.file);
        assertScope();
        row.requestId = deps.requestId();
        row.note = '人工核对原图门店 ' + row.sourceStore + ' · 日期 ' + row.date;
        deps.capture(row, context);
        row.status = 'uploading'; deps.update();
        submitted = true;
        var result = await deps.upload({store:context.store,source_store:row.sourceStore,request_id:row.requestId,report_date:row.date,filename:row.file.name,mime_type:row.file.type,base64:encoded,note:row.note});
        if (!archiveMatches(result,row)) throw Error('存档响应尚未确认');
        row.status = 'done'; row.message = '已存档 '+row.date+' · 请求 '+row.requestId; sent++;
        deps.update();
        // A completed in-flight upload is recorded, but cancellation never starts another file.
        assertScope();
      } catch (error) {
        if (submitted && error.code === 'UPLOAD_SOURCE_STORE_REJECTED') {
          deps.discard(row, context);
          submitted = false;
        }
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
  panel.innerHTML = '<h3>按月存档日报原图</h3><p data-scope></p><p class="help">支持草稿、已入账、锁账和空白日期的 JPG / PNG 原图，每张不超过 10MB。已入账和锁账日期仅补充原件，空白日期仅存档。请逐张看图，选择原图实际所属门店并核对日期。</p><input type="file" multiple accept="image/jpeg,image/png" aria-label="选择本月日报照片"><button type="button" class="ghost" data-refresh>刷新存档与请求状态</button><label>筛选存档日期（留空看全月）<input type="date" data-filter></label><div data-archives></div><button type="button" class="ghost hidden" data-more>加载更多存档</button><div data-rows></div><div class="actions"><button type="button" class="primary" data-start>确认门店和日期并上传</button><button type="button" class="ghost" data-close>关闭</button></div><p role="status" aria-live="polite" data-status></p>';
  anchor.parentNode.after(panel);
  var picker = panel.querySelector('input[type=file]'), list = panel.querySelector('[data-rows]'), start = panel.querySelector('[data-start]'), close = panel.querySelector('[data-close]'), status = panel.querySelector('[data-status]');
  var rows = [], urls = [], scope = null, busy = false, voiding = false, cancelled = false, used = false, generation = 0;
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
  function sourceStorePicker(destination, filename) {
    var select = document.createElement('select');
    select.setAttribute('aria-label', filename + ' 原图所属门店');
    select.appendChild(new Option('请选择原图所属门店', ''));
    var stores = new Set(['自由手艺人', '向里造型', destination].concat(state.user.stores || []));
    stores.forEach(function (name) {
      if (typeof name === 'string' && name) select.appendChild(new Option(name, name));
    });
    return select;
  }
  function revoke() { if(previewViewer&&previewViewer.open)previewViewer.close();urls.forEach(function (url) { URL.revokeObjectURL(url); }); urls = []; }
  function renderStatus() {
    rows.forEach(function (row) {
      var labels = {pending:'待确认',checking:'正在核对日报权限',reading:'正在读取原图',uploading:'正在上传，请勿重复提交',done:'已上传',stopped:'已停止',uncertain:'结果待核对'};
      row.label.textContent = row.message || labels[row.status];
      row.dateInput.disabled = busy || used;
      row.sourceInput.disabled = busy || used;
      row.check.disabled = busy || used || !scope || row.sourceStore !== scope.store;
      if (row.status === 'done' && sameScope()) {
        if (scope.voidedArchives.has(row.requestId)) {
          row.label.textContent = '已作废 · ' + row.date + ' · 请求 ' + row.requestId;
          return;
        }
        if (selectableReceipt(row)) {
          row.label.appendChild(archiveChoice(row.requestId, row.date, row.file.name));
        }
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
    });
    picker.disabled = busy || used; start.disabled = busy || !!listing || used || !rows.length || !sameScope() || rows.some(function (r) { return !r.confirmed || r.sourceStore !== scope.store || r.status !== 'pending'; });
    close.disabled = voiding;
    close.textContent = busy && !voiding ? '停止后续上传' : '关闭';
    renderArchiveControls();
  }
  function stopForChange(event) {
    var privateChange = event || (scope && (scope.actor !== state.user || !permitted() || scope.store !== currentStore() || scope.month !== $('month').value || $('app').classList.contains('hidden') || $('view-daily-report').classList.contains('hidden')));
    generation++;
    if (!scope) return;
    cancelled = true;
    selectedArchives.clear();
    deleteMode = false;
    if (privateChange) { panel.classList.add('hidden'); revoke(); list.textContent = ''; if (archiveList) archiveList.textContent = ''; picker.value = ''; rows = []; }
    status.textContent = voiding ? '作废请求已发出，请回到原门店和月份查看结果。' : '已停止后续上传。已发出的请求不能撤回，请核对下方结果；重新选择门店月份后再打开。';
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
    selectedArchives.clear(); deleteMode = false; renderArchiveControls();
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
      selectedArchives.clear(); deleteMode = false; voidStatus.textContent = '';
      scope = {store:store,month:month,user:user,actor:state.user,requests:[],generation:token,days:data.days||[],locked:data.locked,voidedArchives:new Set(),unverifiedArchives:new Set(),voidReadback:null};
      panel.querySelector('[data-scope]').textContent = store+' · '+month;
      status.textContent = '一次最多选择 100 张，每张单独确认日期。照片原样上传，不压缩。';
      panel.classList.remove('hidden'); renderStatus(); await refreshArchives(false);
    } catch (error) { toast(error.message); } finally { entry.disabled = false; }
  };
  var archiveList = panel.querySelector('[data-archives]'), more = panel.querySelector('[data-more]');
  var refresh = panel.querySelector('[data-refresh]'), filter = panel.querySelector('[data-filter]');
  var offset = 0, listing = null, dateFilter = '', deleteMode = false;
  var selectedArchives = new Map();
  var deletion = document.createElement('div');
  deletion.innerHTML = '<div class="actions"><button type="button" class="ghost" data-delete-mode aria-expanded="false">批量删除误传原图</button></div><div data-delete-controls class="hidden"><p class="help">勾选下方已存档的误传原图，也可直接勾选本次上传成功的原图。每次最多 100 张。作废后从电子日报移除，原文件和操作记录仍可追溯。</p><div class="actions"><button type="button" class="ghost" data-select-uploaded>全选本次已存档</button><button type="button" class="ghost" data-clear-archives>取消勾选</button><button type="button" class="primary" data-void-archives>作废选中原图</button><span aria-live="polite" data-selection-count></span></div><details class="hidden" data-selection-review><summary>查看选中的原图</summary><ul style="max-height:12em;overflow:auto;overflow-wrap:anywhere" data-selected-list></ul></details><p role="status" aria-live="polite" data-void-status></p></div>';
  archiveList.before(deletion);
  var deleteEntry = deletion.querySelector('[data-delete-mode]');
  var deleteControls = deletion.querySelector('[data-delete-controls]');
  var selectUploaded = deletion.querySelector('[data-select-uploaded]');
  var clearArchives = deletion.querySelector('[data-clear-archives]');
  var voidButton = deletion.querySelector('[data-void-archives]');
  var voidStatus = deletion.querySelector('[data-void-status]');
  var selectionCount = deletion.querySelector('[data-selection-count]');
  var selectionReview = deletion.querySelector('[data-selection-review]');
  var selectedList = deletion.querySelector('[data-selected-list]');
  function selectableReceipt(row) {
    return row.status === 'done' && typeof row.requestId === 'string' && !scope.voidedArchives.has(row.requestId) && !scope.unverifiedArchives.has(row.requestId) && (!dateFilter || row.date === dateFilter);
  }
  function renderArchiveControls() {
    var current = sameScope();
    var disabled = !current || busy || !!listing;
    deleteControls.classList.toggle('hidden', !deleteMode);
    deleteEntry.setAttribute('aria-expanded', String(deleteMode));
    deleteEntry.textContent = deleteMode ? '退出批量删除' : '批量删除误传原图';
    deleteEntry.disabled = !current || busy;
    selectUploaded.disabled = disabled || !rows.some(selectableReceipt);
    clearArchives.disabled = disabled || !selectedArchives.size;
    voidButton.disabled = disabled || !deleteMode || !selectedArchives.size;
    refresh.disabled = disabled; filter.disabled = disabled; more.disabled = disabled;
    panel.querySelectorAll('[data-archive-choice]').forEach(function (choice) {
      choice.parentNode.classList.toggle('hidden', !deleteMode);
      choice.disabled = disabled || !deleteMode;
      choice.checked = selectedArchives.has(choice.dataset.archiveChoice);
    });
    selectionCount.textContent = '已选 ' + selectedArchives.size + ' 张';
    selectionReview.classList.toggle('hidden', !selectedArchives.size);
    selectedList.textContent = '';
    selectedArchives.forEach(function (item) {
      var line = document.createElement('li');
      line.textContent = item.date + ' · ' + item.filename;
      selectedList.appendChild(line);
    });
  }
  function archiveChoice(requestId, date, filename) {
    var label = document.createElement('label');
    label.className = 'hidden';
    var choice = document.createElement('input'); choice.type = 'checkbox';
    choice.dataset.archiveChoice = requestId;
    choice.setAttribute('aria-label', '选择作废 ' + date + ' ' + filename);
    var ctx = scope;
    choice.onchange = function () {
      if (!sameScope() || scope !== ctx || busy || listing || !deleteMode) return;
      if (!choice.checked) selectedArchives.delete(requestId);
      else if (selectedArchives.size < 100 || selectedArchives.has(requestId)) selectedArchives.set(requestId, {date:date,filename:filename});
      else voidStatus.textContent = '每次最多作废 100 张，请分次处理。';
      renderArchiveControls();
    };
    label.appendChild(choice);
    label.appendChild(document.createTextNode(' 选择作废 '));
    return label;
  }
  deleteEntry.onclick = function () {
    if (!sameScope() || busy) return;
    deleteMode = !deleteMode;
    selectedArchives.clear();
    voidStatus.textContent = '';
    renderArchiveControls();
  };
  selectUploaded.onclick = function () {
    if (!sameScope() || busy || listing || !deleteMode) return;
    var uploaded = rows.filter(selectableReceipt);
    var additions = uploaded.filter(function (row) { return !selectedArchives.has(row.requestId); });
    if (selectedArchives.size + additions.length > 100) {
      voidStatus.textContent = '选择后将超过 100 张，请先取消部分勾选再试。';
      return;
    }
    additions.forEach(function (row) { selectedArchives.set(row.requestId, {date:row.date,filename:row.file.name}); });
    renderArchiveControls();
  };
  clearArchives.onclick = function () { selectedArchives.clear(); renderArchiveControls(); };
  voidButton.onclick = async function () {
    if (!sameScope() || busy || listing || !deleteMode || !selectedArchives.size || isLocalPreview()) return;
    var ctx = scope, ids = Array.from(selectedArchives.keys());
    var reason = window.prompt('填写作废原因（4–500 字）', '');
    if (reason === null) return;
    reason = reason.trim();
    if (reason.length < 4 || reason.length > 500) { voidStatus.textContent = '作废原因需 4–500 字。'; return; }
    if (!window.confirm('确认作废 ' + ctx.store + ' ' + ctx.month + ' 所选的 ' + ids.length + ' 张原图？\n作废后会从电子日报移除，原文件和操作记录保留。')) return;
    if (!sameScope() || scope !== ctx) return;
    busy = true; voiding = true; voidStatus.textContent = '正在作废所选原图…'; renderStatus();
    try {
      var result = await bounded(api('daily_original_archive_void',{store:ctx.store,request_ids:ids,reason:reason},true),50000);
      if (!sameScope() || scope !== ctx) return;
      if (!result || result.action !== 'void' || result.requested !== ids.length || !Number.isInteger(result.changed) || result.changed < 0 || result.changed > ids.length) throw Error('未收到完整的作废回执');
      ids.forEach(function (id) { ctx.voidedArchives.add(id); });
      ctx.requests = ctx.requests.filter(function (row) { return !ctx.voidedArchives.has(row.requestId); });
      voidStatus.textContent = '所选 ' + ids.length + ' 张已作废（本次新增 ' + result.changed + ' 张）。';
    } catch (error) {
      if (sameScope() && scope === ctx) {
        ids.forEach(function (id) { ctx.unverifiedArchives.add(id); });
        ctx.voidReadback = ids;
        voidStatus.textContent = '作废结果待核对：' + error.message + '。请查看刷新后的存档状态。';
      }
    } finally {
      busy = false; voiding = false; selectedArchives.clear(); renderStatus();
      if (sameScope() && scope === ctx) await refreshArchives(false);
    }
  };
  function dateLabel(date) {
    var days = scope.days.filter(function (day) { return day.report_date === date; });
    if (!days.length || !days[0].draft_id) return '仅存档，尚无日报';
    return scope.locked || days[0].locked || days[0].status !== 'draft' ? '补充原件，不替换已入账或锁账日报' : '独立存档，对应日期有草稿日报';
  }
  async function refreshArchives(append) {
    if (!sameScope() || busy || (listing && listing.scope === scope) || isLocalPreview()) return;
    var ctx = scope, token = generation;
    var request = {scope:ctx}; listing = request;
    renderStatus();
    function current() { return scope === ctx && token === generation && sameScope(); }
    try {
      if (!append) { offset = 0; archiveList.textContent = ''; selectedArchives.clear(); }
      var data = await bounded(api('daily_original_archive_list',{store:ctx.store,month:ctx.month,offset:offset}),50000);
      if (!current()) return;
      if (!Array.isArray(data.archives)) throw Error('存档列表响应无效');
      data.archives.forEach(function (item) {
        if (typeof item.request_id !== 'string' || !validDate(item.report_date,ctx.month)) return;
        if (item.status !== 'archived' && item.status !== 'voided') return;
        ctx.unverifiedArchives.delete(item.request_id);
        if (item.status === 'voided') ctx.voidedArchives.add(item.request_id);
        if (dateFilter && item.report_date !== dateFilter) return;
        var line = document.createElement('p');
        var voided = ctx.voidedArchives.has(item.request_id);
        line.textContent = item.report_date+' · '+item.original_filename+' · '+(voided?'已作废（保留审计）':'已存档')+' · 日期上下文（非财务绑定）：'+dateLabel(item.report_date)+' · '+(item.created_at || '');
        if (voided) { archiveList.appendChild(line); return; }
        line.prepend(archiveChoice(item.request_id, item.report_date, item.original_filename));
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
          if (ctx.voidedArchives.has(row.requestId)) continue;
          try { result = await bounded(api('daily_original_archive_status',{store:ctx.store,request_id:row.requestId}),50000); } catch (_) { result = null; }
          if (!current()) return;
          if (result && result.request_id === row.requestId && result.status === 'voided') {
            ctx.voidedArchives.add(row.requestId); ctx.unverifiedArchives.delete(row.requestId); continue;
          }
          var done = archiveMatches(result,row), text = document.createElement('p');
          text.textContent = row.date+' · '+row.file.name+' · '+(done?'已核对存档成功':'结果待核对，请勿重传')+' · 请求 '+row.requestId;
          archiveList.appendChild(text);
          if (!done) {
            unresolved.push(row);
            (function (savedRow, container) {
              var pick = document.createElement('input'); pick.type = 'file'; pick.accept = 'image/jpeg,image/png'; pick.setAttribute('aria-label','重新选择同一原图以恢复请求 '+savedRow.requestId);
              var sourceStore = sourceStorePicker(ctx.store, savedRow.file.name);
              var resume = document.createElement('button'); resume.type = 'button'; resume.textContent = '核对原文件并恢复此请求';
              resume.onclick = async function () {
                if (!current() || busy) return;
                var file = pick.files && pick.files[0];
                if (!file || fileError(file) || file.name !== savedRow.file.name || file.size !== savedRow.file.size || file.type !== savedRow.file.type) { status.textContent = '须重新选择完全相同的原文件，不能更改日期或请求编号'; return; }
                var verifiedStore = sourceStore.value;
                try { validateSourceStore(verifiedStore, ctx.store); } catch (error) { status.textContent = error.message; return; }
                sourceStore.disabled = true;
                busy = true; resume.disabled = true; renderStatus();
                try {
                  var hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(function (n) { return n.toString(16).padStart(2,'0'); }).join('');
                  if (hash !== savedRow.sha256) throw Error('文件内容不一致，未恢复请求');
                  if (!current()) return;
                  if (!window.confirm('确认恢复 '+ctx.store+' '+savedRow.date+' 的原图存档？使用原请求编号，不修改财务数据。')) return;
                  var encoded = await bounded(fileBase64(file),45000);
                  if (!current()) return;
                  var originalNote = typeof savedRow.note === 'string' ? savedRow.note : DEFAULT_ARCHIVE_NOTE;
                  var result = await bounded(api('daily_original_archive_resume',{store:ctx.store,source_store:verifiedStore,request_id:savedRow.requestId,report_date:savedRow.date,filename:file.name,mime_type:file.type,base64:encoded,note:originalNote},true),ARCHIVE_UPLOAD_WAIT_MS);
                  if (!current()) return;
                  status.textContent = archiveMatches(result,savedRow) ? '恢复请求已确认存档，请刷新列表' : '恢复结果待核对，请刷新请求状态，勿新建请求重传';
                } catch (error) { if (current()) status.textContent = '恢复尚未确认：'+error.message+'。保留原请求编号，请刷新状态核对。'; }
                finally { busy = false; resume.disabled = false; sourceStore.disabled = false; renderStatus(); }
              };
              container.appendChild(pick); container.appendChild(sourceStore); container.appendChild(resume);
            })(row,text);
          }
        }
        ctx.requests = unresolved;
      }
      if (ctx.voidReadback && ctx.voidReadback.every(function (id) { return !ctx.unverifiedArchives.has(id); })) {
        var verified = ctx.voidReadback.filter(function (id) { return ctx.voidedArchives.has(id); }).length;
        voidStatus.textContent = '存档已核对：' + verified + ' / ' + ctx.voidReadback.length + ' 张显示为已作废。';
        ctx.voidReadback = null;
      }
    } catch (error) { if (current()) status.textContent = '存档查询失败：'+error.message+'。未重试上传。'; }
    finally { if (listing === request) { listing = null; renderStatus(); } }
  }
  filter.onchange = function () { if (!sameScope() || busy || listing) return; var date = this.value; if (date && !validDate(date,scope.month)) { this.value = dateFilter; return; } dateFilter = date; refreshArchives(false); };
  refresh.onclick = function () { refreshArchives(false); };
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
      var sourceStore = sourceStorePicker(scope.store, file.name); box.appendChild(sourceStore);
      var date = document.createElement('input'); date.type = 'date'; date.value = suggestedDate(file.name,scope.month); date.setAttribute('aria-label',file.name+' 对应日报日期');
      date.min = scope.month+'-01'; date.max = scope.month+'-'+new Date(Number(scope.month.slice(0,4)),Number(scope.month.slice(5,7)),0).getDate(); box.appendChild(date);
      var label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; label.appendChild(check); label.appendChild(document.createTextNode('我已看图确认门店和日期')); box.appendChild(label);
      var result = document.createElement('p'); result.className = 'help'; box.appendChild(result); list.appendChild(box);
      var row = {file:file,date:date.value,sourceStore:'',confirmed:false,status:'pending',message:invalid,label:result,dateInput:date,sourceInput:sourceStore,check:check}; rows.push(row);
      function validateRow(checked) {
        if (busy || used || !sameScope()) return;
        row.date = date.value; row.sourceStore = sourceStore.value; row.confirmed = false;
        try {
          if (invalid) throw Error(invalid);
          validateSourceStore(row.sourceStore, scope.store);
          targetFor(row.date, scope);
          row.confirmed = checked;
          row.message = checked ? '已核对 · ' + row.sourceStore + ' · ' + row.date : '请看图核对门店和日期';
        } catch (error) { row.message = error.message; }
        check.checked = row.confirmed;
        renderStatus();
      }
      function resetConfirmation() { validateRow(false); }
      date.onchange = resetConfirmation;
      sourceStore.onchange = resetConfirmation;
      check.onchange = function () { validateRow(check.checked); };
      resetConfirmation();
    });
    renderStatus();
  };
  start.onclick = async function () {
    if (busy || listing || used || !sameScope() || !rows.length || rows.some(function (row) { return !row.confirmed || row.sourceStore !== scope.store; })) return;
    if (isLocalPreview()) { status.textContent = '本地预览不上传真实文件。'; return; }
    if (!window.confirm('确认将 '+rows.length+' 张原图按已核对门店和日期上传到 '+scope.store+' '+scope.month+' 的独立原图存档？')) return;
    busy = true; used = true; renderStatus();
    try {
      var outcome = await runBatch(rows,scope,{
        current:sameScope,update:renderStatus,
        requestId:function () { return crypto.randomUUID(); },
        capture:function (row, ctx) {
          ctx.requests.push({requestId:row.requestId,date:row.date,sha256:row.sha256,note:row.note,file:{name:row.file.name,size:row.file.size,type:row.file.type}});
        },
        discard:function (row, ctx) {
          ctx.requests = ctx.requests.filter(function (request) { return request.requestId !== row.requestId; });
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
