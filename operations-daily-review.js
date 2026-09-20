/* Keep OCR suggestions distinct from finance-reviewed daily-sheet values. */
(function () {
  'use strict';

  function pendingCandidates() {
    var root = document.getElementById('daily-detail-grid');
    if (!root) return [];
    return Array.from(root.querySelectorAll('input.recognition-candidate[data-daily-cell][type="number"],input.recognition-candidate[data-row-label-input]'))
      .filter(function (input) {
        return input.value.trim() !== '' && !input.classList.contains('manual-edit');
      });
  }

  function notice(message) {
    var element = document.getElementById('daily-detail-note');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  var renderControlsBase = renderDailyDetailControls;
  renderDailyDetailControls = function () {
    renderControlsBase();
    var sheet = state.imports.sheet;
    var pending = pendingCandidates().length;
    var dirty = dailySheetDirtyCount();
    var validation = sheet.draft.validation_result || {};
    var reviewed = document.getElementById('daily-detail-reviewed').checked;
    var writable = sheet.permissions && sheet.permissions.write;
    var candidateHelp = document.getElementById('daily-detail-candidates');
    candidateHelp.textContent = pending
      ? '黄色数字／姓名中仍有 ' + pending + ' 格仅是机器候选，尚未全部计入后台校验或人工核对记录。请对照原图修改错格，再勾选逐格核对并点击“采纳已核对候选”；此操作只保存候选，不会入账。'
      : '当前没有待采纳的数字或姓名候选；最终入账仍需财务确认。';
    var adopt = document.getElementById('daily-detail-adopt');
    adopt.disabled = !writable || !reviewed || pending === 0;
    adopt.textContent = pending ? '采纳已核对候选（' + pending + '）' : '无待采纳候选';
    if (sheet.draft.status === 'confirmed' || dirty || !writable || (sheet.locked && !sheet.daily_unlock_approved)) return;
    var missing = Array.isArray(validation.missing_controls) ? validation.missing_controls : [];
    var reason = pending
      ? '还有 ' + pending + ' 个机器候选数字／姓名未采纳；请先对照原图核对。'
      : validation.valid !== true
        ? (missing.length ? '后台仍缺少已核对的 ' + missing.join('、') : '后台校验仍未通过，请核对四组合计。')
        : '';
    if (!reason) return;
    var confirm = document.getElementById('daily-detail-confirm');
    confirm.dataset.blockReason = reason;
    confirm.classList.add('blocked-action');
    confirm.textContent = '查看未能入账原因';
    document.getElementById('daily-detail-confirm-help').textContent = reason;
  };
  var reviewedCheckbox = document.getElementById('daily-detail-reviewed');
  reviewedCheckbox.removeEventListener('change', renderControlsBase);
  reviewedCheckbox.addEventListener('change', renderDailyDetailControls);

  var lastDraftId = '';
  var renderDetailBase = renderDailySheetDetail;
  renderDailySheetDetail = function () {
    var draftId = String(state.imports.sheet && state.imports.sheet.draft.id || '');
    if (lastDraftId !== draftId) notice('');
    lastDraftId = draftId;
    renderDetailBase();
  };

  var saveBase = saveDailyReportDetail;
  var saveButtons = [document.getElementById('daily-detail-save'), document.getElementById('daily-detail-save-top')];
  saveButtons.forEach(function (button) {
    button.removeEventListener('click', saveBase);
  });
  var saving = false;
  saveDailyReportDetail = async function () {
    var sheet = state.imports.sheet;
    if (saving) {
      notice('上一笔电子日报修改仍在保存，请等待结果。');
      return false;
    }
    if (!sheet || dailySheetDirtyCount() === 0) {
      notice('没有待保存的修改；黄色机器候选仍须逐格核对并采纳。');
      return true;
    }
    var date = String(sheet.draft.report_date);
    var store = currentStore();
    notice('正在保存 ' + date + ' 的电子日报，请稍候…');
    var preview = isLocalPreview() || String(sheet.draft.id).indexOf('preview') === 0;
    saving = true;
    var saved = false;
    try {
      saved = await saveBase();
    } catch (error) {
      notice('保存失败：' + error.message + '。本页未保存的格子仍在。');
      return false;
    } finally {
      saving = false;
    }
    if (!saved) {
      notice('保存未完成：请查看提示，并确认修改原因、网络与账号权限；本页未保存的格子仍在。');
      return false;
    }
    var revision = Number(state.imports.sheet.draft.edit_revision || 0);
    var remaining = pendingCandidates().length;
    notice(preview
      ? '当前是本地预览，修改没有写入后台，也没有入账。'
      : '保存成功 · 修订 v' + revision + (remaining ? ' · 还有 ' + remaining + ' 个机器候选未核对' : ' · 已重新校验') + '。保存草稿不会自动入账。');
    if (preview) return true;
    try {
      if (store === currentStore() && state.dailyReportMonth && state.dailyReportMonth.month === date.slice(0, 7)) {
        state.dailyReportMonth = await api('daily_sheet_month', { store: store, month: date.slice(0, 7) });
        renderDailyReportCalendar(state.dailyReportMonth);
      }
    } catch (error) {
      notice('电子日报已保存（修订 v' + revision + '），但月历刷新失败：' + error.message + '。可点击“刷新”重试。');
    }
    return true;
  };
  saveButtons.forEach(function (button) {
    button.addEventListener('click', saveDailyReportDetail);
  });

  var renderCalendarBase = renderDailyReportCalendar;
  renderDailyReportCalendar = function (data) {
    renderCalendarBase(data);
    (data.days || []).forEach(function (day) {
      if (day.status === 'confirmed' || day.grand_total == null) return;
      var cell = document.querySelector('#daily-report-calendar [data-daily-day="' + day.report_date + '"] .day-total');
      if (cell) cell.textContent = '待确认参考金额 ¥' + Number(day.grand_total).toFixed(2);
    });
  };

  document.getElementById('daily-detail-adopt').addEventListener('click', async function () {
    var sheet = state.imports.sheet;
    if (!sheet || !(sheet.permissions && sheet.permissions.write)) return;
    if (!document.getElementById('daily-detail-reviewed').checked) {
      notice('请先逐格对照原始日报，再勾选核对确认。');
      return;
    }
    var candidates = pendingCandidates();
    if (!candidates.length) return;
    if (!window.confirm('确认已逐格对照原图，并采纳这 ' + candidates.length + ' 个黄色数字／姓名？此操作仅保存草稿和审计记录，不会正式入账。')) return;
    candidates.forEach(function (input) {
      if (input.dataset.dailyCell) state.imports.dirty[input.dataset.dailyCell] = input.value;
      else state.imports.dirtyLabels[input.dataset.rowLabelInput] = input.value;
      input.classList.add('manual-edit');
    });
    renderDailyDetailControls();
    await saveDailyReportDetail();
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
