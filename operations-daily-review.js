/* Daily sheet actions: save a draft, or explicitly review and post it once. */
(function () {
  'use strict';
  var active = null;
  var disabledControls = new Map();
  var uncertainPosts = new Set();
  var quietRefresh = false, syncPending = false, syncCheckedAt = 0, syncKey = '';
  var syncMessage = '';
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
    return { id: String(sheet.draft.id), date: String(sheet.draft.report_date), store: currentStore(), revision: Number(sheet.draft.edit_revision) };
  }
  function contextKey(ctx) { return JSON.stringify([ctx.store, ctx.id]); }
  function isCurrent(ctx) {
    var sheet = state.imports.sheet;
    return !!sheet && String(sheet.draft.id) === ctx.id && String(sheet.draft.report_date) === ctx.date
      && Number(sheet.draft.edit_revision) === ctx.revision && currentStore() === ctx.store;
  }
  function applySheet(ctx, sheet, quiet) {
    if (!isCurrent(ctx) || !sheet || String(sheet.draft.id) !== ctx.id || String(sheet.draft.report_date) !== ctx.date) {
      throw new Error('当前门店或日报已变化，请重新打开核对');
    }
    state.imports.sheet = sheet;
    ctx.revision = Number(sheet.draft.edit_revision);
    state.imports.dirty = {};
    state.imports.dirtyLabels = {};
    syncMessage = '';
    quietRefresh = !!quiet;
    var x = window.scrollX, y = window.scrollY;
    var scrolls = Array.from(grid().querySelectorAll('.daily-grid-scroll')).map(function (el) { return [el.scrollLeft, el.scrollTop]; });
    try { renderDailySheetDetail(); }
    finally { quietRefresh = false; }
    if (quiet) {
      grid().querySelectorAll('.daily-grid-scroll').forEach(function (el, i) { if (scrolls[i]) { el.scrollLeft = scrolls[i][0]; el.scrollTop = scrolls[i][1]; } });
      window.scrollTo(x, y);
    }
  }
  function sheetVersion(sheet) {
    // Signed image URLs change on reads; they are not a financial revision.
    return JSON.stringify([sheet.draft.edit_revision, sheet.draft.status, sheet.draft.source_voucher_id,
      sheet.draft.validation_result, sheet.cells, sheet.permissions, sheet.locked, sheet.daily_unlock_approved,
      (sheet.attachments || []).map(function (item) { return [item.id, item.voucher_id, item.voided, item.audit_status]; })]);
  }
  function sourceBusy() { return !!(window.ZysyrDailySourceActions && window.ZysyrDailySourceActions.busy()); }
  function syncStatus(message) {
    syncMessage = message;
    var element = document.getElementById('daily-detail-sync-status');
    if (!element) {
      element = document.createElement('div');
      element.id = 'daily-detail-sync-status';
      element.className = 'help';
      element.setAttribute('role', 'status');
      document.getElementById('daily-detail-meta').after(element);
    }
    element.textContent = message;
    element.hidden = !message;
  }
  function localInputActive() {
    var detail = document.getElementById('daily-report-detail');
    var focused = document.activeElement;
    return dailySheetDirtyCount() > 0 || !!document.getElementById('daily-detail-reason').value.trim()
      || !!detail.querySelector('details[open]')
      || Array.from(detail.querySelectorAll('input[type=file]')).some(function (input) { return input.files.length > 0; })
      || (detail.contains(focused) && focused.matches('input,textarea,select'));
  }
  async function checkBeforeWrite(ctx) {
    var previous = state.imports.sheet;
    var fresh = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
    if (!isCurrent(ctx) || state.imports.sheet !== previous) throw new Error('当前日报已变化，请重新核对');
    if (String(fresh.draft.id) !== ctx.id || String(fresh.draft.report_date) !== ctx.date) throw new Error('返回的日报不一致，本次未提交');
    if (sheetVersion(fresh) !== sheetVersion(previous)) {
      // A prior save may have committed even when its reply/readback was lost.
      // Adopt only a strictly newer, fully matching saved form, never a blind rebase.
      if (dailySheetDirtyCount()) {
        try {
          verifyCommittedDraft(ctx, fresh, reviewedValues(), collectDailySheetCells(grid()));
          applySheet(ctx, fresh, true);
          return fresh;
        } catch (_) { /* Real differences keep the existing conflict protection. */ }
      }
      if (!dailySheetDirtyCount()) applySheet(ctx, fresh, true);
      throw new Error(dailySheetDirtyCount()
        ? '后台日报已有更新，本页修改已保留，未覆盖后台；请保留修改内容并重新打开最新日报核对'
        : fresh.draft.status === 'confirmed' ? '这张日报已入账，已更新页面，无需重复提交'
        : '已更新到最新日报，请重新核对后再操作');
    }
    return fresh;
  }
  async function syncDailySheet() {
    if (!detailOpen() || !state.imports.sheet || !state.user || document.hidden || navigator.onLine === false
      || active || sourceBusy() || syncPending || isLocalPreview()) return;
    var ctx = context(), key = contextKey(ctx);
    if (key === syncKey && Date.now() - syncCheckedAt < 30000) return;
    syncKey = key; syncCheckedAt = Date.now(); syncPending = true;
    var previous = state.imports.sheet;
    var protectedInput = localInputActive();
    try {
      var fresh = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id });
      // Check again after the request: the user may have started typing or navigated.
      if (!detailOpen() || document.hidden || active || sourceBusy() || !isCurrent(ctx) || state.imports.sheet !== previous) return;
      if (String(fresh.draft.id) !== ctx.id || String(fresh.draft.report_date) !== ctx.date) throw new Error('日报范围不一致');
      if (sheetVersion(fresh) !== sheetVersion(previous) || uncertainPosts.has(key)) {
        if (protectedInput || localInputActive()) {
          syncStatus('后台日报已有更新；本页填写内容已保留，请保留修改内容并核对最新版本后再保存或入账。');
          return;
        }
        var uncertain = uncertainPosts.has(key);
        applySheet(ctx, fresh, true);
        uncertainPosts.delete(key);
        renderDailyDetailControls();
        syncStatus(fresh.draft.status === 'confirmed' ? '已核实：此日报已入账，无需重复提交。'
          : uncertain ? '已核实：此日报仍为草稿，请核对后再入账。' : '已同步最新日报，请按最新内容核对。');
      } else if (syncMessage) syncStatus('');
    } catch (_) {
      if (detailOpen() && !active && isCurrent(ctx) && state.imports.sheet === previous) syncStatus('暂时无法检查最新日报，填写内容未清除；保存和入账前会再次核对。');
    } finally { syncPending = false; }
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
    var receiptChecks = c.cashMode ? [
      ['summary_actual', '实做', c.actual, c.cashflow == null ? null : c.cashflow + (c.earnedMode ? c.card : 0), c.earnedMode ? '现金业绩＋实际获得卡金业绩' : '项目及零售实际收款'],
      ['summary_grand', '汇总总计', c.grand, c.cashflow == null || c.cardSales == null ? null : c.cashflow + c.cardSales + (c.earnedMode ? c.card : 0), '实做＋充值售卡实收'],
      ['payment_cashflow', '现金流', c.cashflow, c.methodTotal, '经营收款渠道合计'],
      ['payment_total', '支付总计', c.payment, c.grand, c.earnedMode ? '现金业绩＋实际获得卡金业绩＋充值售卡实收' : '经营收款＋充值售卡实收（不含卡金扣款）'],
    ] : [
      ['summary_actual', '实做', c.actual, c.staffAtomic, '员工合计'],
      ['summary_grand', '汇总总计', c.grand, c.staffAtomic, '员工合计'],
      ['payment_cashflow', '现金流', c.cashflow, c.methodTotal, '支付方式合计'],
      ['payment_total', '支付总计', c.payment, c.cashflow == null ? null : c.cashflow + c.card, '现金流＋卡金消费'],
    ];
    return [
      ['stylist_category_subtotal', '造型区总小计', c.stylistSubtotal, c.staffAtomic, '员工明细合计'],
    ].concat(receiptChecks).filter(function (item) {
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
    if (sheet.draft.template_code === 'zysyr_frontdesk_project_draft' && !confirmed) {
      help.textContent = '收银项目明细已自动填写，黄色为待核对数据；技师仅统计烫、染、护个数。'
        + '空白不代表零：全业务总额、卡金及未分类项目仍需核对。本表未自动入账。';
      if (calculateDailyControls(grid()).cashMode) help.textContent = '实做和现金流只计项目、零售的实际外部收款（含微信、支付宝、团购、抖音）；充值、套餐及年卡实收另列卡类小计，不计实做。卡金扣款不计收入。来源范围仍待财务核对，本表未自动入账。';
      if (calculateDailyControls(grid()).earnedMode) help.textContent = '日报实做＝现金业绩＋实际获得卡金业绩；两处总计另含充值售卡实收。卡金消费按获得业绩，不按原始划卡额。月报美发收入只取现金流，不含卡金。未知字段保留待核对，本表未自动入账。';
    }
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
    if (lastDraftId !== id) { notice(''); syncMessage = ''; document.getElementById('daily-detail-reason').value = ''; }
    lastDraftId = id;
    renderDetailBase();
    syncStatus(syncMessage);
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
  function saveGuard(sheet) {
    return JSON.stringify([sheet.draft.status, sheet.draft.template_code, sheet.draft.source_voucher_id,
      sheet.permissions, sheet.locked, sheet.daily_unlock_approved,
      (sheet.attachments || []).map(function (item) { return [item.id, item.voucher_id, item.voided, item.audit_status]; })]);
  }
  function verifyCommittedDraft(ctx, sheet, snapshot, edits) {
    var previous = state.imports.sheet;
    if (!isCurrent(ctx) || !sheet || !sheet.draft || String(sheet.draft.id) !== ctx.id
      || String(sheet.draft.report_date) !== ctx.date || sheet.draft.status !== 'draft'
      || !Number.isSafeInteger(Number(sheet.draft.edit_revision)) || Number(sheet.draft.edit_revision) <= ctx.revision
      || saveGuard(sheet) !== saveGuard(previous) || reviewedValues() !== snapshot) {
      throw new Error('保存结果或日报权限已变化，本页填写已保留，请核对最新日报');
    }
    verifySavedValues(sheet, snapshot);
    // Equal displayed numbers alone are not proof that manual review/blank edits saved.
    if (!edits.length || !edits.every(function (edit) {
      var cell = (sheet.cells || []).find(function (item) {
        return (!edit.id || String(item.id) === String(edit.id)) && item.section_code === edit.section_code
          && item.row_key === edit.row_key && item.column_code === edit.column_code;
      });
      if (!Object.prototype.hasOwnProperty.call(edit, 'value')) {
        var row = (sheet.cells || []).filter(function (item) { return item.section_code === edit.section_code && item.row_key === edit.row_key; });
        return row.length > 0 && row.every(function (item) {
          return String(item.row_label || '').trim() === String(edit.row_label || '').trim() && item.row_label_source_method === 'manual';
        });
      }
      return cell && cell.manual_override === true && (edit.value == null
        ? cell.corrected_numeric == null
        : cell.corrected_numeric != null && Number(cell.corrected_numeric) === Number(edit.value));
    })) throw new Error('后台尚未完整保存本页人工核对内容；填写已保留，请核对后重试');
  }
  async function persistDraft(ctx, reason, versionChecked) {
    if (!isCurrent(ctx)) throw new Error('当前日报已变化，请重新打开');
    if (!dailySheetDirtyCount()) return;
    if (!versionChecked) await checkBeforeWrite(ctx);
    if (!dailySheetDirtyCount()) return; // Preflight recovered a prior committed save.
    var snapshot = reviewedValues(), cells = collectDailySheetCells(grid());
    var result;
    try {
      result = await api('daily_sheet_save', { store: ctx.store, draft_id: ctx.id, expected_revision: ctx.revision, cells: cells, reason: reason });
      verifyCommittedDraft(ctx, result, snapshot, cells);
    } catch (error) {
      // Exactly one read, no automatic repeat write. If unavailable, the next
      // explicit action runs the same guarded preflight against the retained form.
      notice('正在查询草稿保存结果，请勿重复提交…');
      var recovered;
      try { recovered = await api('daily_sheet_read', { store: ctx.store, draft_id: ctx.id }); }
      catch (_) { throw new Error('暂时无法核实草稿保存结果，本页填写已保留；网络恢复后再次点击会先核对后台结果'); }
      if (recovered && recovered.draft && Number(recovered.draft.edit_revision) === ctx.revision) throw error;
      verifyCommittedDraft(ctx, recovered, snapshot, cells);
      result = recovered;
    }
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
      var latest = await checkBeforeWrite(ctx);
      pendingCandidates().forEach(function (input) {
        if (input.dataset.dailyCell) state.imports.dirty[input.dataset.dailyCell] = input.value;
        else state.imports.dirtyLabels[input.dataset.rowLabelInput] = input.value;
        input.classList.add('manual-edit');
      });
      if (dailySheetDirtyCount()) await persistDraft(ctx, saveReason, true);
      else {
        var fresh = latest;
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
      await api('daily_sheet_confirm', { store: ctx.store, draft_id: ctx.id, expected_revision: ctx.revision, is_business_day: null, reviewed_all: true, reason: saveReason });
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
      if (cell) cell.textContent = '待入账金额 ¥' + dailyAmountDisplay(day.grand_total);
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
  window.ZysyrDailyReview = { hasWork: hasWork, sync: syncDailySheet, isQuietRefresh: function () { return quietRefresh; } };
  setInterval(syncDailySheet, 60000);
  window.addEventListener('focus', syncDailySheet);
  window.addEventListener('pageshow', syncDailySheet);
  window.addEventListener('online', syncDailySheet);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncDailySheet(); });
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
  // The daily cash rollup remains the monthly hair-income starting value, but
  // finance may override that month-only value through the audited adjustment
  // path in operations.html. Do not make the daily-linked monthly cell readonly.
})();
