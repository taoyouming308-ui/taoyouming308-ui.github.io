/* Manual original-photo archive only. Never creates, recognizes or posts a daily sheet. */
(function (root) {
  'use strict';
  var MAX_BYTES = 10 * 1024 * 1024;
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
    if (!file || !file.size || file.size > MAX_BYTES) return '照片须大于 0 且不超过 10MB';
    if (['image/jpeg', 'image/png'].indexOf(file.type) < 0) return '仅支持 JPG / PNG 原图，请先转换其他格式';
    return '';
  }
  function targetFor(date, context) {
    if (!validDate(date, context.month)) throw Error('请选择本月的有效日期');
    var days = (context.days || []).filter(function (day) { return day.report_date === date; });
    if (days.length !== 1 || !days[0].draft_id) throw Error('该日没有唯一电子日报，请先在日历中手动建立并核对');
    if (days[0].status !== 'draft') throw Error('该日已入账或不可编辑，现有接口不支持补传原图');
    if (context.locked || days[0].locked) throw Error('该日期已锁账，请先按原流程处理');
    return days[0].draft_id;
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
        var draftId = targetFor(row.date, context);
        row.status = 'checking'; deps.update();
        var sheet = await deps.read({store:context.store,draft_id:draftId});
        assertScope();
        if (!sheet || !sheet.draft || sheet.draft.id !== draftId || sheet.draft.report_date !== row.date || sheet.draft.status !== 'draft' || sheet.locked || !sheet.permissions || !sheet.permissions.upload_original) throw Error('日报状态或权限已变化，请重新打开并核对');
        row.status = 'reading'; deps.update();
        var encoded = await deps.encode(row.file);
        assertScope();
        row.status = 'uploading'; deps.update();
        submitted = true;
        var result = await deps.upload({store:context.store,draft_id:draftId,filename:row.file.name,mime_type:row.file.type,base64:encoded,attachment_kind:'original_report',note:'人工逐张核对日期后批量留存原图：'+row.date+'；不自动识别或入账'});
        if (!result || result.attachment_uploaded !== true || !result.draft || result.draft.id !== draftId || result.draft.report_date !== row.date) throw Error('上传响应缺少有效确认');
        row.status = 'done'; row.message = '已上传并绑定 '+row.date; sent++;
        deps.update();
        // A completed in-flight upload is recorded, but cancellation never starts another file.
        assertScope();
      } catch (error) {
        if (row.status !== 'done') {
          row.status = submitted ? 'uncertain' : 'stopped';
          row.message = submitted ? '结果待核对，可能已上传。请打开该日日报检查原件，勿直接重传。' : error.message;
        }
        deps.update();
        return {sent:sent, stopped:true, uncertain:submitted && row.status !== 'done'};
      }
    }
    return {sent:sent, stopped:false};
  }
  var exported = {validDate:validDate,suggestedDate:suggestedDate,fileError:fileError,targetFor:targetFor,runBatch:runBatch};
  if (typeof module !== 'undefined' && module.exports) { module.exports = exported; return; }
  root.ZysyrDailyBatchUpload = exported;
  var anchor = document.getElementById('daily-open-import');
  if (!anchor) return;
  var entry = document.createElement('button'); entry.type = 'button'; entry.className = 'ghost import-entry';
  entry.id = 'daily-batch-upload'; entry.textContent = '批量补传草稿日报原图'; anchor.after(entry);
  var panel = document.createElement('section'); panel.className = 'form-card hidden'; panel.id = 'daily-batch-panel';
  panel.innerHTML = '<h3>按月整理草稿日报原图</h3><p data-scope></p><p class="help">仅为已有、未锁账的草稿日报补传 JPG / PNG 原图，每张不超过 10MB。不会建表、自动识别、覆盖金额或入账。已入账及空白日期暂不支持；文件名日期仅供参考，请逐张看图核对。</p><input type="file" multiple accept="image/jpeg,image/png" aria-label="选择本月日报照片"><div data-rows></div><div class="actions"><button type="button" class="primary" data-start>确认日期并上传</button><button type="button" class="ghost" data-close>关闭</button></div><p role="status" aria-live="polite" data-status></p>';
  anchor.parentNode.after(panel);
  var picker = panel.querySelector('input[type=file]'), list = panel.querySelector('[data-rows]'), start = panel.querySelector('[data-start]'), close = panel.querySelector('[data-close]'), status = panel.querySelector('[data-status]');
  var rows = [], urls = [], scope = null, busy = false, cancelled = false, used = false, generation = 0;
  function permitted() { return state.user && !state.user.personal_scope && state.user.can_import_photo_reports; }
  function sameScope() { return !cancelled && permitted() && scope && scope.generation === generation && scope.store === currentStore() && scope.month === $('month').value && state.view === 'daily-report' && scope.user === state.user.username; }
  function revoke() { urls.forEach(function (url) { URL.revokeObjectURL(url); }); urls = []; }
  function renderStatus() {
    rows.forEach(function (row) {
      var labels = {pending:'待确认',checking:'正在核对日报权限',reading:'正在读取原图',uploading:'正在上传，请勿重复提交',done:'已上传',stopped:'已停止',uncertain:'结果待核对'};
      row.label.textContent = row.message || labels[row.status];
      row.dateInput.disabled = busy || used; row.check.disabled = busy || used;
    });
    picker.disabled = busy || used; start.disabled = busy || used || !rows.length || !sameScope() || rows.some(function (r) { return !r.confirmed || r.status !== 'pending'; });
    close.textContent = busy ? '停止后续上传' : '关闭';
  }
  function stopForChange() {
    generation++;
    if (!scope) return;
    cancelled = true;
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
      if (scope && (!permitted() || $('app').classList.contains('hidden') || $('view-daily-report').classList.contains('hidden'))) stopForChange();
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
    if (scope && !panel.classList.contains('hidden')) { panel.scrollIntoView({block:'nearest'}); return; }
    var store = currentStore(), month = $('month').value, user = state.user.username, token = ++generation;
    entry.disabled = true;
    try {
      var data = isLocalPreview() ? previewDailySheetMonth() : await api('daily_sheet_month',{store:store,month:month});
      if (token !== generation || store !== currentStore() || month !== $('month').value || !permitted() || user !== state.user.username || state.view !== 'daily-report') return;
      if (data.month !== month || !data.permissions || !data.permissions.write) throw Error('本月日报尚不可上传');
      revoke(); rows = []; list.textContent = ''; picker.value = ''; cancelled = false; used = false;
      scope = {store:store,month:month,user:user,generation:token,days:data.days||[],locked:data.locked};
      panel.querySelector('[data-scope]').textContent = store+' · '+month;
      status.textContent = '一次最多选择 100 张，每张单独确认日期。照片原样上传，不压缩。';
      panel.classList.remove('hidden'); renderStatus();
    } catch (error) { toast(error.message); } finally { entry.disabled = false; }
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
      if (!invalid) { var img = document.createElement('img'), url = URL.createObjectURL(file); urls.push(url); img.src = url; img.alt = '请核对这张日报的日期'; img.style.cssText = 'display:block;max-width:100%;max-height:240px;margin:8px 0'; box.appendChild(img); }
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
    if (!window.confirm('确认将 '+rows.length+' 张原图按已核对日期上传到 '+scope.store+' '+scope.month+' 的已有草稿日报？\n仅留存原件，不自动识别或入账。')) return;
    busy = true; used = true; renderStatus();
    try {
      var outcome = await runBatch(rows,scope,{
        current:sameScope,update:renderStatus,
        read:function (payload) { return bounded(api('daily_sheet_read',payload),50000); },
        encode:function (file) { return bounded(fileBase64(file),45000); },
        // retried=true disables even auth-refresh replay for this non-idempotent upload.
        upload:function (payload) { return bounded(api('daily_sheet_attachment_upload',payload,true),90000); }
      });
      status.textContent = '已确认上传 '+outcome.sent+' / '+rows.length+' 张。'+(outcome.stopped?'批次已停止，未发送的照片没有上传。请核对每张结果。':'请刷新月历后打开对应日报查看原件。');
      if (outcome.uncertain) status.textContent += '存在结果待核对的上传，未自动重试；请先检查对应日报原件。';
    } finally { busy = false; renderStatus(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
