/* Daily sheet actions: save a draft, or explicitly review and post it once. */
(function () {
  'use strict';
  var active = null;
  var disabledControls = new Map();
  var uncertainPosts = new Set();
  var saveButtons = ['daily-detail-save', 'daily-detail-save-top'].map(function (id) { return document.getElementById(id); });
  var postButtons = ['daily-detail-confirm', 'daily-detail-confirm-top'].map(function (id) { return document.getElementById(id); });

  function grid() { return document.getElementById('daily-detail-grid'); }
  function pendingCandidates() {
    return Array.from(grid().querySelectorAll('input.recognition-candidate[data-daily-cell],input.recognition-candidate[data-row-label-input]'))
      .filter(function (input) { return input.value.trim() !== '' && !input.classList.contains('manual-edit'); });
  }
  function notice(message) {
    var element = document.getElementById('daily-detail-note');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }
  function context() {
    var sheet = state.imports.sheet;
    return { id: String(sheet.draft.id), date: String(sheet.draft.report_date), store: currentStore() };
  }
  function contextKey(ctx) { return JSON.stringify([ctx.store, ctx.id]); }
  function isCurrent(ctx) {
    var sheet = state.imports.sheet;
    return !!sheet && String(sheet.draft.id) === ctx.id && String(sheet.draft.report_date) === ctx.date && currentStore() === ctx.store;
  }
  function applySheet(ctx, sheet) {
    if (!isCurrent(ctx) || !sheet || String(sheet.draft.id) !== ctx.id || String(sheet.draft.report_date) !== ctx.date) {
      throw new Error('当前门店或日报已变化，请重新打开核对');
    }
    state.imports.sheet = sheet;
    state.imports.dirty = {};
    state.imports.dirtyLabels = {};
    renderDailySheetDetail();
  }
  function lockControls() {
    if (!active) return;
    document.querySelectorAll('#app button,#app input,#app select,#app textarea').forEach(function (element) {
      if (!disabledControls.has(element)) disabledControls.set(element, element.disabled);
      element.disabled = true;
    });
  }
  function begin(kind) {
    if (active) return false;
    active = kind;
    renderDailyDetailControls();
    return true;
  }
  function end() {
    disabledControls.forEach(function (disabled, element) { element.disabled = disabled; });
    disabledControls.clear();
    active = null;
    if (state.imports.sheet) renderDailyDetailControls();
  }
  function showProblem(message) {
    notice(message);
    toast(message);
    var target = grid().querySelector('.control-mismatch') || document.getElementById('daily-detail-confirm-help');
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (target.focus) target.focus(); }
  }
  function controlDifferences(c) {
    var amount = function (value) { return value == null ? '空白' : Number(value).toFixed(2) + ' 元'; };
    return [
      ['summary_actual', '实做', c.actual, c.staffAtomic, '员工合计'],
      ['summary_grand', '汇总总计', c.grand, c.staffAtomic, '员工合计'],
      ['payment_cashflow', '现金流', c.cashflow, c.methodTotal, '支付方式合计'],
      ['payment_total', '支付总计', c.payment, c.cashflow == null ? null : c.cashflow + c.card, '现金流＋卡金消费'],
    ].filter(function (item) {
      return item[2] == null || item[3] == null || Math.abs(item[2] - item[3]) > 0.01;
    }).map(function (item) {
      return { role: item[0], message: item[1] + '为 ' + amount(item[2]) + '，' + item[4] + '为 ' + amount(item[3]) };
    });
  }
  function localBlockReason() {
    var sheet = state.imports.sheet, c = calculateDailyControls(grid());
    if (sheet.draft.status === 'confirmed') return '这张日报已入账。';
    if (!(sheet.permissions && sheet.permissions.write) || state.user.role !== 'finance') return '仅财务账号可以入账。';
    if (sheet.locked) return '本月已锁账，暂不能入账；请先完成解锁审批。';
    var approved = !!sheet.draft.source_voucher_id || (sheet.attachments || []).some(function (item) {
      return item.audit_status === 'approved' && item.document_type === 'daily_report';
    });
    if (!approved) return '请先上传当天原始日报，并完成原件审核。';
    if (!c.valid) {
      var differences = controlDifferences(c);
      return differences.length ? '请核对：' + differences.map(function (item) { return item.message; }).join('；') + '。' : '合计仍有差异，请核对红色金额及员工、项目小计。';
    }
    return '';
  }

  var renderControlsBase = renderDailyDetailControls;
  renderDailyDetailControls = function () {
    renderControlsBase();
    var sheet = state.imports.sheet, confirmed = sheet.draft.status === 'confirmed';
    var uncertain = uncertainPosts.has(contextKey(context()));
    var writable = sheet.permissions && sheet.permissions.write && !confirmed && !uncertain && (!sheet.locked || sheet.daily_unlock_approved);
    var dirty = dailySheetDirtyCount(), pending = pendingCandidates().length;
    var differences = controlDifferences(calculateDailyControls(grid()));
    grid().querySelectorAll('[data-daily-cell],[data-new-cell]').forEach(function (input) {
      var issue = differences.find(function (item) { return item.role === input.dataset.role; });
      input.setAttribute('aria-label', (input.dataset.rowLabel || '') + ' · ' + input.dataset.columnLabel);
      if (['summary_actual', 'summary_grand', 'payment_cashflow', 'payment_total'].includes(input.dataset.role)) input.classList.toggle('control-mismatch', !!issue);
      input.readOnly = !writable;
    });
    grid().querySelectorAll('[data-row-label-input]').forEach(function (input) { input.readOnly = !writable; });
    var help = document.getElementById('daily-detail-candidates');
    help.textContent = pending && !confirmed ? '黄色为识别内容，请对照原图核对；点击“入账”时会一并保存核对结果。' : '';
    help.classList.toggle('hidden', !help.textContent);
    var reason = localBlockReason();
    document.getElementById('daily-detail-confirm-help').textContent = confirmed
      ? '已入账，已计入当天及月报；更正需走修订流程。'
      : uncertain ? '上次入账结果待查询；点击“入账”先查询结果。'
      : reason || '保存草稿：留存修改，可继续编辑。入账：核对后计入当天和月报。';
    postButtons.forEach(function (button) {
      button.textContent = confirmed ? '已入账' : active === 'post' ? '正在入账…' : '入账';
      button.disabled = confirmed || !(sheet.permissions && sheet.permissions.write) || state.user.role !== 'finance' || !!active;
      button.dataset.blockReason = confirmed ? '' : reason;
      button.classList.toggle('blocked-action', !confirmed && !!reason);
      button.title = confirmed ? '此日报已经入账' : '核对后保存并入账，自动更新月报';
    });
    saveButtons.forEach(function (button) {
      button.textContent = active === 'save' ? '正在保存…' : '保存草稿';
      button.disabled = !writable || dirty === 0 || !!active;
    });
    if (confirmed) document.getElementById('daily-detail-state').textContent = '已入账';
    lockControls();
  };

  var lastDraftId = '';
  var renderDetailBase = renderDailySheetDetail;
  renderDailySheetDetail = function () {
    var id = String(state.imports.sheet && state.imports.sheet.draft.id || '');
    if (lastDraftId !== id) { notice(''); document.getElementById('daily-detail-reason').value = ''; }
    lastDraftId = id;
    renderDetailBase();
  };

  function reviewedValues(root) {
    return JSON.stringify(Array.from((root || grid()).querySelectorAll('[data-daily-cell],[data-new-cell],[data-row-label-input]')).map(function (input) {
      var key = [input.dataset.section, input.dataset.rowKey || input.dataset.rowLabelInput, input.dataset.columnCode || 'row_label'];
      var value = input.type === 'number' && input.value.trim() !== '' ? Number(input.value) : input.value.trim();
      return [key, value];
    }).sort(function (a, b) { return JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])); }));
  }
  function verifySavedValues(sheet, snapshot) {
    var previous = state.imports.sheet, paper = document.createElement('div');
    try {
      state.imports.sheet = sheet;
      paper.innerHTML = dailyPaperSheet();
      if (reviewedValues(paper) !== snapshot) throw new Error('后台回读内容与刚才核对的内容不同；本页修改已保留，请勿重新填写整张表');
    } finally { state.imports.sheet = previous; }
  }
  async function persistDraft(ctx, reason) {
    if (!isCurrent(ctx)) throw new Error('当前日报已变化，请重新打开');
    if (!dailySheetDirtyCount()) return;
    var snapshot = reviewedValues(), cells = collectDailySheetCells(grid());
    var result = await api('daily_sheet_save', { store: ctx.store, draft_id: ctx.id, cells: cells, reason: reason });
    verifySavedValues(result, snapshot);
    applySheet(ctx, result);
  }
  async function refreshCalendar(ctx) {
    var data = await api('daily_sheet_month', { store: ctx.store, month: ctx.date.slice(0, 7) });
    if (!isCurrent(ctx)) return;
    state.dailyReportMonth = data;
    renderDailyReportCalendar(data);
  }
  var saveBase = saveDailyReportDetail;
  saveButtons.forEach(function (button) { button.removeEventListener('click', saveBase); });
  saveDailyReportDetail = async function () {
    if (active || !state.imports.sheet) return false;
    if (uncertainPosts.has(contextKey(context()))) { showProblem('请先点击“入账”查询上次结果，再继续编辑。'); return false; }
    if (!dailySheetDirtyCount()) { notice('草稿已保存；核对完成后可点击“入账”。'); return true; }
    var sheet = state.imports.sheet;
    if (!(sheet.permissions && sheet.permissions.write) || sheet.draft.status !== 'draft' || (sheet.locked && !sheet.daily_unlock_approved)) {
      showProblem('当前日报不可编辑，请检查账号权限或锁账状态。'); return false;
    }
    if (isLocalPreview() || String(sheet.draft.id).indexOf('preview') === 0) {
      notice('当前是本地预览，没有保存到后台。'); return false;
    }
    var ctx = context(), reason = document.getElementById('daily-detail-reason').value.trim() || '保存电子日报草稿';
    begin('save');
    notice('正在保存草稿…');
    try {
      await persistDraft(ctx, reason);
      notice('保存成功。草稿可继续编辑，尚未入账。');
      try { await refreshCalendar(ctx); } catch (_) { notice('草稿已保存；月历刷新失败，可稍后刷新。'); }
      return true;
    } catch (error) {
      if (isCurrent(ctx)) showProblem('保存失败：' + error.message + '。修改仍保留在页面中。');
      return false;
    } finally { end(); }
  };
  saveButtons.forEach(function (button) { button.addEventListener('click', saveDailyReportDetail); });

  async function finishPosted(ctx, result) {
    uncertainPosts.delete(contextKey(ctx));
    if (!isCurrent(ctx)) return;
    if (result) applySheet(ctx, result);
    else { state.imports.sheet.draft.status = 'confirmed'; renderDailySheetDetail(); }
    notice('入账成功 · ' + ctx.store + ' · ' + ctx.date + '。已计入当天及月报。');
    toast('日报入账成功');
    try { await refreshCalendar(ctx); } catch (_) { notice('入账成功，月历刷新失败；稍后刷新即可查看金额。'); }
  }

  window.confirmDailyReportDetail = async function () {
    if (active || !state.imports.sheet || state.imports.sheet.draft.status === 'confirmed') return;
    var ctx = context(), sheet = state.imports.sheet;
    if (!(sheet.permissions && sheet.permissions.write) || state.user.role !== 'finance') { showProblem('仅财务账号可以入账。'); return; }
    if (uncertainPosts.has(contextKey(ctx))) {
      begin('post');
      try {
        var current = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
        if (current.draft.status === 'confirmed') await finishPosted(ctx, current);
        else {
          applySheet(ctx, current);
          uncertainPosts.delete(contextKey(ctx));
          notice('已查询：日报仍为草稿，请核对后再次点击“入账”。');
        }
      } catch (_) { notice('暂时无法查询上次入账结果，请恢复网络后再点击“入账”查询。'); }
      finally { end(); }
      return;
    }
    var reason = localBlockReason();
    if (reason) { showProblem(reason); return; }
    if (isLocalPreview() || ctx.id.indexOf('preview') === 0) { notice('当前是本地预览，不能正式入账。'); return; }
    var c = calculateDailyControls(grid());
    if (!window.confirm('确认入账？\n\n门店：' + ctx.store + '\n日期：' + ctx.date + '\n金额：¥' + Number(c.grand).toFixed(2) + '\n\n点击“确定”表示：我已逐格核对原图，确认姓名、金额、空白格及支付方式正确。\n系统将保存本页修改与已核对的识别内容，通过校验后入账并计入月报。')) return;
    var snapshot = reviewedValues();
    var saveReason = document.getElementById('daily-detail-reason').value.trim() || '财务逐格核对原图并确认入账';
    begin('post');
    var submitted = false;
    notice('正在保存并校验日报…');
    try {
      pendingCandidates().forEach(function (input) {
        if (input.dataset.dailyCell) state.imports.dirty[input.dataset.dailyCell] = input.value;
        else state.imports.dirtyLabels[input.dataset.rowLabelInput] = input.value;
        input.classList.add('manual-edit');
      });
      if (dailySheetDirtyCount()) await persistDraft(ctx, saveReason);
      else {
        var fresh = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
        verifySavedValues(fresh, snapshot);
        applySheet(ctx, fresh);
      }
      if (!isCurrent(ctx)) throw new Error('当前日报已变化，请重新核对');
      if (state.imports.sheet.draft.status === 'confirmed') { await finishPosted(ctx, state.imports.sheet); return; }
      if (reviewedValues() !== snapshot) throw new Error('后台回读内容与刚才核对的内容不同，请重新核对后入账');
      reason = localBlockReason();
      if (reason) throw new Error(reason);
      var validation = state.imports.sheet.draft.validation_result || {};
      if (validation.valid !== true || pendingCandidates().length) {
        var missing = Array.isArray(validation.missing_controls) ? validation.missing_controls.join('、') : '';
        throw new Error(missing ? '后台校验未通过，需核对：' + missing : '后台校验尚未通过，请核对合计或未核对的识别内容');
      }
      notice('校验通过，正在入账…');
      submitted = true;
      await api('daily_sheet_confirm', { store: ctx.store, draft_id: ctx.id, is_business_day: null, reviewed_all: true, reason: saveReason });
      var posted = null;
      try { posted = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id }); } catch (_) {}
      await finishPosted(ctx, posted && posted.draft.status === 'confirmed' ? posted : null);
    } catch (error) {
      if (submitted) {
        try {
          var recovered = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
          if (recovered.draft.status === 'confirmed') { await finishPosted(ctx, recovered); return; }
          applySheet(ctx, recovered);
          showProblem('入账未完成：' + error.message + '。草稿已保存，可核对后重试。');
        } catch (_) {
          uncertainPosts.add(contextKey(ctx));
          if (isCurrent(ctx)) notice('暂未收到入账结果。再次点击“入账”会先查询结果，避免重复提交。');
        }
      } else if (isCurrent(ctx)) showProblem('尚未入账：' + error.message + '。请核对后重试。');
    } finally { end(); }
  };

  var renderCalendarBase = renderDailyReportCalendar;
  renderDailyReportCalendar = function (data) {
    renderCalendarBase(data);
    (data.days || []).forEach(function (day) {
      var tile = document.querySelector('#daily-report-calendar [data-daily-day="' + day.report_date + '"]');
      if (!tile) return;
      var badge = tile.querySelector('.voucher-status'), cell = tile.querySelector('.day-total');
      if (day.status === 'confirmed') { if (badge) badge.textContent = '已入账'; return; }
      if (badge) badge.textContent = Number(day.edit_revision || 0) > 0 ? '草稿已保存 · 待入账' : '待填写';
      if (cell) cell.textContent = '待入账金额 ¥' + Number(day.grand_total).toFixed(2);
    });
  };

  function detailOpen() {
    return state.view === 'daily-report' && !document.getElementById('daily-report-detail').classList.contains('hidden');
  }
  function hasWork() {
    if (!detailOpen() || !state.imports.sheet) return false;
    var ctx = context();
    if (displayedScope) ctx.store = displayedScope.store;
    return !!active || dailySheetDirtyCount() > 0 || uncertainPosts.has(contextKey(ctx));
  }
  window.ZysyrDailyReview = { hasWork: hasWork };
  // Select changes fire after the value changes: restore the original scope before
  // any existing handler can fetch or save a different store/month.
  var displayedScope = null, renderWithScope = renderDailySheetDetail;
  renderDailySheetDetail = function () {
    renderWithScope();
    displayedScope = { store: document.getElementById('store-select').value,
      month: document.getElementById('month').value, dailyMonth: document.getElementById('daily-month').value };
  };
  document.addEventListener('change', function (event) {
    var field = { 'store-select': 'store', month: 'month', 'daily-month': 'dailyMonth' }[event.target.id];
    if (!field || !displayedScope || !hasWork()) return;
    event.target.value = displayedScope[field];
    event.stopImmediatePropagation();
    toast('当前日报有未保存修改或待查询结果，请先保存草稿或完成入账，再切换。');
  }, true);
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button || !hasWork() || !['logout','refresh','daily-report-refresh','daily-month-prev','daily-month-next','daily-readonly-back','daily-detail-back'].includes(button.id)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    toast('请先保存当前日报修改，再离开或刷新。');
  }, true);
  window.addEventListener('beforeunload', function (event) {
    if (!hasWork()) return;
    event.preventDefault(); event.returnValue = '';
  });
  var renderMonthlyBase = renderSheet;
  renderSheet = function (display, noTrace, editable) {
    renderMonthlyBase(display, noTrace, editable);
    (display && display.cells || []).forEach(function (cell) {
      if (!(cell.daily_rollup && Number(cell.daily_rollup.confirmed_days) > 0)) return;
      var input = document.querySelector('#monthly-sheet input[data-monthly-cell="' + cell.cell_address + '"]');
      if (!input) return;
      input.readOnly = true;
      input.title = '美发收入来自已确认日报累计，不能在月报重复录入';
      input.classList.add('daily-rollup-readonly');
    });
  };
})();
