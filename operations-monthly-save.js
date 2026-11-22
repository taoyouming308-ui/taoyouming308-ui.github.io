/* Monthly report batch editing: one user-authorized attempt, persistent per-cell results. */
(function () {
  'use strict';
  var button = $('monthly-save-cells'), panel = $('monthly-save-result'), latest = null;
  var validAmount = /^-?\d{1,14}(?:\.\d{1,4})?$/;
  function changes() {
    return [['amount', state.monthlyDirty], ['text', state.monthlyTextDirty]].flatMap(function (pair) {
      return Object.values(pair[1] || {}).map(function (change) {
        return {type: pair[0], change: change, status: 'queued'};
      });
    });
  }
  function pending(row) {
    return (row.type === 'amount' ? state.monthlyDirty : state.monthlyTextDirty)[row.change.address];
  }
  function current(batch, change) {
    return state.user === batch.user && state.view === 'monthly' && monthlyReportScopeMatches(batch.scope)
      && (!change || Object.is(state.monthlyDirty[change.address], change) || Object.is(state.monthlyTextDirty[change.address], change));
  }
  function finish(row, status) {
    if (pending(row) === row.change) {
      delete (row.type === 'amount' ? state.monthlyDirty : state.monthlyTextDirty)[row.change.address];
      updateMonthlyDirtyScope();
    }
    row.status = status;
    row.message = '';
    row.latest = null;
  }
  function fail(row, error) {
    row.status = 'pending';
    row.latest = error.monthlyLatest || null;
    row.message = error.code === 'API_OUTCOME_UNCONFIRMED'
      ? '未收到保存回执，输入已保留；再次提交前会先核对后台，不重复写入。'
      : apiError({error: error.message, code: error.code}, error.status).message;
    if (row.latest && row.type === 'amount') row.message += '。后台当前：' + formatted(row.latest.value);
  }
  function describe(row) {
    var name = row.change.label;
    return row.change.address + (name && name !== row.change.address ? ' · ' + name : row.type === 'text' ? ' · 名称' : '');
  }
  function textValue(value) { return String(value == null ? '' : value).trim(); }
  function formatted(value) { return value == null || value === '' ? '（空白）' : String(value); }
  function render() {
    var batch = latest, visible = batch && state.user === batch.user
      && batch.scope.store === currentStore() && batch.scope.month === $('month').value;
    panel.hidden = !visible;
    if (!visible) {
      panel.querySelector('[data-monthly-save-summary]').textContent = '';
      panel.querySelector('[data-monthly-save-items]').replaceChildren();
      return;
    }
    var rows = batch.rows.filter(function (row) { return row.status === 'saved' || row.status === 'verified' || pending(row) === row.change; });
    var kept = rows.filter(function (row) { return row.status === 'pending' || row.status === 'queued' || row.status === 'sending'; }).length;
    panel.querySelector('[data-monthly-save-summary]').textContent = state.monthlySaving
      ? '正在逐格保存并核对，请勿关闭页面。'
      : '本次月报保存：已确认 ' + (rows.length - kept) + ' 项，未保存或待确认 ' + kept + ' 项。'
        + (kept ? ' 未保存输入仍在本页，请按下方提示处理。' : '');
    var list = panel.querySelector('[data-monthly-save-items]');
    list.replaceChildren();
    rows.forEach(function (row) {
      var item = document.createElement('li');
      item.dataset.monthlySaveCell = row.change.address;
      item.textContent = describe(row) + '：' + (row.status === 'saved' ? '已保存'
        : row.status === 'verified' ? '已核对，后台已有该值（未重复提交）'
        : row.status === 'pending' ? '未保存或待确认 · ' + (row.message || '请重试核对') + '；你的输入：' + formatted(row.change.value)
        : row.status === 'sending' ? '正在保存' : '等待检查');
      var input = row.status === 'pending' && monthlyReportScopeMatches(batch.scope)
        && $('monthly-sheet').querySelector('input[data-monthly-cell="' + row.change.address + '"],input[data-monthly-text-cell="' + row.change.address + '"]');
      if (input) {
        input.title = row.message;
        input.setAttribute('aria-invalid', 'true');
        if (row.latest && !state.monthlySaving) {
          var action = document.createElement('button');
          action.type = 'button';
          action.className = 'ghost';
          action.textContent = '重新核对 ' + row.change.address;
          action.onclick = function () {
            if (latest !== batch || !current(batch, row.change) || state.monthlySaving) return;
            if (!window.confirm(describe(row) + '\n后台当前值：' + formatted(row.latest.value)
              + '\n你的修改：' + formatted(row.change.value) + '\n\n确认以该当前值重新核对？只更新本页核对基准，不会提交。')) return;
            Object.assign(row.change, {expected_before: row.latest.expected_before}, row.type === 'text'
              ? {expected_revision: row.latest.expected_revision} : {adjustment_revision: row.latest.adjustment_revision});
            row.latest = null;
            row.message = '已重新核对。点击「保存本月修改」提交这格；仍会检查后台是否再次变化。';
            render();
          };
          item.append(' ', action);
        }
      }
      list.append(item);
    });
  }
  async function saveNames(rows, batch, reason) {
    if (!rows.length || !current(batch)) return;
    var submitted = [];
    try {
      // One scoped read for all names; use the actual version, never overwrite an
      // edited name or infer success from a blank/missing field.
      var fresh = await api('overview', {store:batch.scope.store, month:batch.scope.month});
      var report = fresh?.monthly_report;
      if (!current(batch) || report?.id !== batch.scope.report_id || !Array.isArray(report.display_data?.editable_text_cells)) throw new Error('原月报或名称格未能核对，本次未提交名称');
      var values = new Map(report.display_data.editable_text_cells.map(function (cell) { return [cell.cell_address, cell]; }));
      rows.forEach(function (row) {
        var change = row.change, live = values.get(change.address);
        if (!current(batch, change)) return;
        if (!live) { fail(row, new Error('当前月报没有这个可编辑名称格')); return; }
        var value = textValue(live.current_text == null ? live.original_text : live.current_text), revision = Number(live.revision?.revision || 0);
        if (value === textValue(change.value)) { finish(row, 'verified'); return; }
        if (value !== change.expected_before || revision !== change.expected_revision) {
          var conflict = new Error('名称或版本已改变，需要重新核对。当前：' + formatted(value));
          conflict.monthlyLatest = {value: value, expected_before: value, expected_revision: revision};
          fail(row, conflict);
          return;
        }
        if (change.value.length > 80 || /[\x00-\x1f\x7f]/.test(change.value)) { fail(row, new Error('名称最多 80 个字符且不能换行')); return; }
        if (submitted.length >= 50) { fail(row, new Error('单次最多保存 50 个名称，这格请在下一次提交')); return; }
        submitted.push(row);
        row.status = 'sending';
      });
      render();
      if (!submitted.length || !submitted.every(function (row) { return current(batch, row.change); })) return;
      var receipt = await api('monthly_text_save', Object.assign({}, batch.scope, {
        cells: submitted.map(function (row) { return row.change; }), reason: reason
      }), true);
      var saved = receipt?.saved?.saved;
      if (receipt?.report_id !== batch.scope.report_id || !Array.isArray(saved) || !submitted.every(function (row) {
        return saved.some(function (cell) { return cell.cell_address === row.change.address && cell.after_text === row.change.value; });
      })) throw new Error('未收到完整的名称保存回执，正在读取实际保存状态');
      if (current(batch)) submitted.forEach(function (row) { finish(row, 'saved'); });
    } catch (error) {
      (submitted.length ? submitted : rows).filter(function (row) { return pending(row) === row.change && !row.latest; })
        .forEach(function (row) { fail(row, error); });
    }
  }
  async function submit() {
    if (state.monthlySaving || !state.monthlyOverviewReady || state.view !== 'monthly') return;
    var rows = changes(), scope = voucherContext(), batch = {scope: scope, user: state.user, rows: rows};
    if (!rows.length) { toast('没有金额或名称发生变化'); return; }
    if (isLocalPreview()) { toast('本地预览不写入数据库'); return; }
    if (state.monthlyDirtyScope?.owner && state.monthlyDirtyScope.owner !== monthlyEditOwner()) {
      toast('未保存内容属于之前的登录会话，请用原账号核对。'); return;
    }
    if (!scope.report_id || (state.monthlyDirtyScope && !monthlyReportScopeMatches(state.monthlyDirtyScope))) {
      batch.scope = state.monthlyDirtyScope || scope;
      rows.forEach(function (row) { fail(row, new Error('原月报版本已变化。请先记下这些输入，核对新版本后再修改。')); });
      latest = batch; render(); return;
    }
    var reason = window.prompt('请输入本次修改原因（会保存在操作审计中）：');
    if (!reason || !reason.trim()) return;
    reason = reason.trim();
    if (reason.length > 480) { toast('修改原因请控制在 480 字以内，待保存内容仍在本页。'); return; }
    latest = batch;
    state.monthlySaving = scope;
    button.disabled = true;
    $('monthly-sheet').querySelectorAll('input[data-monthly-cell],input[data-monthly-text-cell]').forEach(function (input) {
      input.readOnly = true; input.dataset.monthlySaveLocked = 'true';
    });
    updateMonthlySaveLabel();
    var reloaded = false;
    try {
      for (var row of rows.filter(function (item) { return item.type === 'amount'; })) {
        if (!current(batch, row.change)) continue;
        if (!validAmount.test(row.change.value)) { fail(row, new Error('请填写有效金额，空白不会按 0 保存，最多四位小数')); continue; }
        row.status = 'sending';
        render();
        try {
          var receipt = await saveMonthlyAmountAdjustment(row.change, reason + '（月报 ' + row.change.address + '）', null, {
            scope: scope, current: function (change) { return current(batch, change); }
          });
          if (!current(batch, row.change)) continue;
          finish(row, receipt.skipped ? 'verified' : 'saved');
        } catch (error) { fail(row, error); }
      }
      await saveNames(rows.filter(function (item) { return item.type === 'text'; }), batch, reason);
      if (current(batch)) reloaded = await loadOverview();
      if (current(batch) && reloaded) rows.forEach(function (row) {
        if ((row.status === 'pending' || row.status === 'sending') && !pending(row)) finish(row, 'verified');
      });
    } catch (error) {
      rows.filter(function (row) { return pending(row) === row.change; }).forEach(function (row) { fail(row, error); });
    } finally {
      rows.forEach(function (row) {
        if (row.status === 'sending' || row.status === 'queued') fail(row, new Error('保存结果未确认，修改仍留在原月报，请核对后再继续'));
      });
      state.monthlySaving = null;
      $('monthly-sheet').querySelectorAll('[data-monthly-save-locked]').forEach(function (input) {
        input.readOnly = false; delete input.dataset.monthlySaveLocked;
      });
      if (current(batch) && reloaded && !monthlyHasUnsaved()) renderMonthlyAuditControls(false);
      button.disabled = state.monthlyOverviewReady === false;
      updateMonthlySaveLabel();
    }
  }
  window.ZysyrMonthlySave = {
    submit: submit, render: render, clear: function () { latest = null; render(); },
    reconciled: function (change) {
      if (!latest || !current(latest)) return;
      var row = latest.rows.find(function (item) { return item.change === change; });
      if (row && row.status !== 'saved') finish(row, 'verified');
    }
  };
})();
