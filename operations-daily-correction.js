/* Account-specific, explicit correction of a confirmed daily report.
 * Ordinary draft save/post and source uploads are never used in this flow. */
(function () {
  'use strict';
  var edit = null, busy = false, disabled = new Map();
  function sheet() { return state.imports.sheet; }
  function context() {
    var s = sheet();
    return s && { id: String(s.draft.id), date: String(s.draft.report_date), store: currentStore(), revision: Number(s.draft.edit_revision) };
  }
  function current(ctx) {
    var c = context();
    return c && ctx && c.id === ctx.id && c.store === ctx.store && c.date === ctx.date && c.revision === ctx.revision;
  }
  function allowed() {
    var s = sheet();
    return !!(s && state.user && state.user.can_correct_confirmed_daily && s.permissions
      && s.permissions.correct_confirmed && s.draft.status === 'confirmed' && !s.locked);
  }
  function editing() { return !!(edit && current(edit.ctx) && allowed() && !edit.uncertain && !edit.committed); }
  function message(text) {
    document.getElementById('daily-detail-note').textContent = text;
    document.getElementById('daily-detail-note').classList.remove('hidden');
    status.textContent = text; panel.classList.remove('hidden');
  }
  var actions = document.createElement('div');
  actions.className = 'compact-actions hidden';
  actions.id = 'daily-correction-actions';
  actions.innerHTML = '<button id="daily-correction-start" class="secondary" type="button">更正已入账日报</button>'
    + '<button id="daily-correction-submit" class="primary hidden" type="button">提交更正</button>'
    + '<button id="daily-correction-cancel" class="ghost hidden" type="button">取消更正</button>';
  document.getElementById('daily-detail-state').parentElement.appendChild(actions);
  var panel = document.createElement('div');
  panel.id = 'daily-correction-panel'; panel.className = 'daily-readonly-note hidden';
  var status = document.createElement('div');
  status.id = 'daily-correction-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  panel.appendChild(status);
  document.getElementById('daily-detail-grid').before(panel);
  var reasonInput = document.getElementById('daily-detail-reason'), reasonDetails = reasonInput.closest('details');
  var reasonHome = document.createComment('daily correction reason home');
  reasonDetails.before(reasonHome);
  var reasonSummary = reasonDetails.querySelector('summary'), originalSummary = reasonSummary.textContent, originalPlaceholder = reasonInput.placeholder;
  var panelContext = null;
  function problem(text, target) {
    message(text); toast(text);
    (target || panel).scrollIntoView({behavior: 'smooth', block: 'center'});
    if (target && target.focus) target.focus({preventScroll: true});
  }
  var start = document.getElementById('daily-correction-start'), submit = document.getElementById('daily-correction-submit'), cancel = document.getElementById('daily-correction-cancel');
  function controls() {
    if (edit && !current(edit.ctx)) edit = null;
    var ctx = context(), key = ctx && JSON.stringify([ctx.store, ctx.id]);
    if (panelContext !== key) { panelContext = key; status.textContent = ''; panel.classList.add('hidden'); }
    if (edit) {
      panel.classList.remove('hidden'); panel.appendChild(reasonDetails); reasonDetails.open = true;
      reasonSummary.textContent = '更正原因（必填）'; reasonInput.placeholder = '说明本次更正的原因'; reasonInput.required = true;
    } else {
      reasonHome.after(reasonDetails); reasonSummary.textContent = originalSummary;
      reasonInput.placeholder = originalPlaceholder; reasonInput.required = false;
    }
    actions.classList.toggle('hidden', !allowed() && !edit);
    start.classList.toggle('hidden', !!edit);
    submit.classList.toggle('hidden', !edit);
    cancel.classList.toggle('hidden', !edit || !!edit.uncertain || !!edit.committed);
    submit.textContent = busy ? '正在核对…' : edit && (edit.uncertain || edit.committed) ? '查询更正结果' : '提交更正';
    start.disabled = busy; submit.disabled = busy; cancel.disabled = busy;
    if (edit && current(edit.ctx)) {
      var writable = editing() && !busy;
      document.getElementById('daily-detail-grid').querySelectorAll('[data-daily-cell],[data-new-cell],[data-row-label-input]').forEach(function (input) { input.readOnly = !writable; });
      document.getElementById('daily-detail-reason').disabled = !writable;
      document.getElementById('daily-detail-confirm-help').textContent = edit.committed
        ? '更正已提交成功，正在核实最新日报；不要重复提交。'
        : edit.uncertain ? '尚未收到更正结果，先查询；本页修改已保留，未盲目重复入账。'
        : '更正前的账仍然有效。逐格核对并填写原因后提交；旧版和凭证永久保留。';
    }
  }
  var baseControls = renderDailyDetailControls;
  renderDailyDetailControls = function () { baseControls(); controls(); };
  var baseEnsureSaved = ensureDailySheetSaved;
  ensureDailySheetSaved = async function () {
    if (edit) { message('请先提交、查询结果或取消本次更正，再离开日报。'); return false; }
    return baseEnsureSaved();
  };
  function setBusy(value) {
    busy = value;
    if (value) document.querySelectorAll('#app button,#app input,#app select,#app textarea').forEach(function (el) {
      disabled.set(el, el.disabled); el.disabled = true;
    });
    else { disabled.forEach(function (value, el) { el.disabled = value; }); disabled.clear(); renderDailyDetailControls(); }
    if (value) controls();
  }
  start.onclick = function () {
    if (!allowed() || busy || edit) return;
    edit = { ctx: context(), requestId: crypto.randomUUID(), uncertain: false, committed: false };
    document.getElementById('daily-detail-reason').value = '';
    state.imports.dirty = {}; state.imports.dirtyLabels = {};
    renderDailySheetDetail();
    var reason = document.getElementById('daily-detail-reason');
    reason.closest('details').open = true;
    reason.placeholder = '必填：说明本次更正的原因';
    message('仅本页临时编辑，尚未改变原账。修改金额后需同时核对行小计、列小计、实做、支付方式。');
  };
  cancel.onclick = function () {
    if (!edit || busy || edit.uncertain || edit.committed) return;
    if (dailySheetDirtyCount() && !confirm('取消本次尚未提交的更正？原账不会改变。')) return;
    edit = null; state.imports.dirty = {}; state.imports.dirtyLabels = {};
    document.getElementById('daily-detail-reason').value = '';
    renderDailySheetDetail(); message('已取消更正，原账保持不变。');
  };
  async function adopt(ctx) {
    var fresh = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
    if (!current(ctx) || String(fresh.draft.id) !== ctx.id || String(fresh.draft.report_date) !== ctx.date
      || fresh.draft.status !== 'confirmed' || Number(fresh.draft.edit_revision) <= ctx.revision) throw new Error('尚未读到本次更正后的日报，请查询结果');
    state.imports.sheet = fresh; edit = null; state.imports.dirty = {}; state.imports.dirtyLabels = {};
    document.getElementById('daily-detail-reason').value = '';
    renderDailySheetDetail(); message('更正已完成；旧版本、修改前后值和原因已保留，月报不会重复计入旧版。');
    state.dailyReportMonth = null;
  }
  async function queryResult(ctx) {
    var result = await api('daily_sheet_correction_status', { store: ctx.store, draft_id: ctx.id, request_id: edit.requestId });
    if (!current(ctx)) throw new Error('当前日报已变化，请重新打开');
    if (result.applied) { edit.committed = true; await adopt(ctx); return true; }
    edit.uncertain = false;
    message('已查询：本次更正尚未提交成功。本页修改已保留，请核对后再提交。');
    return false;
  }
  submit.onclick = async function () {
    if (busy) return;
    if (!edit || !current(edit.ctx)) { problem('当前日报已变化，本次未提交；请保留修改内容并核对最新版本。'); return; }
    var ctx = edit.ctx;
    if (edit.uncertain || edit.committed) {
      message('正在查询上次更正结果，不会重复提交…');
      setBusy(true);
      try { await queryResult(ctx); } catch (error) { message('暂时无法核实更正结果：' + error.message + '；请稍后查询，不要重复提交。'); }
      finally { setBusy(false); }
      return;
    }
    if (!editing()) { problem('当前没有更正权限或月份已锁定，本次未提交；本页内容已保留。'); return; }
    var reason = document.getElementById('daily-detail-reason').value.trim(), grid = document.getElementById('daily-detail-grid');
    if (!reason) { problem('更正已入账日报必须填写修改原因。', reasonInput); return; }
    var cells;
    try {
      if (!dailySheetDirtyCount()) { problem('还没有修改，无需提交更正。'); return; }
      if (!calculateDailyControls(grid).valid) { problem('合计仍有差异，请核对红色金额和表格下方校验项；本次未提交，原账不变。'); return; }
      if (isLocalPreview()) { problem('预览页面不能更正生产账。'); return; }
      cells = collectDailySheetCells(grid);
    } catch (error) { problem('本页校验失败：' + error.message + '；未提交，修改内容已保留。'); return; }
    if (!confirm('确认已对照原图核对全部金额？将保留旧账并提交更正版，不会重复统计。')) {
      problem('未确认提交，本次修改仍留在页面，原账不变。'); return;
    }
    message('正在提交更正并核实结果，请勿关闭页面或重复点击…');
    setBusy(true);
    try {
      var result = await api('daily_sheet_correct', { store: ctx.store, draft_id: ctx.id, expected_revision: ctx.revision,
        request_id: edit.requestId, cells: cells, reason: reason, reviewed_all: true });
      if (!current(ctx) || !result.corrected || !result.saved || result.saved.request_id !== edit.requestId) throw new Error('未收到匹配的更正确认');
      edit.committed = true;
      await adopt(ctx);
    } catch (error) {
      if (edit && current(ctx)) {
        edit.uncertain = true;
        try {
          if (!await queryResult(ctx)) message('更正未完成：' + error.message + '。本页修改已保留，原账不变。');
        } catch (_) { message('更正结果暂未核实；本页修改已保留。请点击“查询更正结果”，不要重复提交。'); }
      }
    } finally { setBusy(false); }
  };
  window.ZysyrDailyCorrection = { editing: editing, busy: function () { return busy; }, protectedInput: function () { return !!edit; } };
  window.addEventListener('beforeunload', function (event) {
    if (edit && (dailySheetDirtyCount() || edit.uncertain || edit.committed)) { event.preventDefault(); event.returnValue = ''; }
  });
})();
