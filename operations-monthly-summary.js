/* Multi-month viewing is separate from the editable single-month ledger. */
(function () {
  'use strict';
  var generation = 0, renderedScope = '';
  var css = document.createElement('style');
  css.textContent = '.monthly-summary-active #monthly-sheet,.monthly-summary-active #report-state,'
    + '.monthly-summary-active #monthly-materials,.monthly-summary-active .sheet-caption,'
    + '.monthly-summary-active #monthly-summary-bar>.finance-upload,.monthly-summary-active #monthly-unlock-request,'
    + '.monthly-summary-active #monthly-lock-status,.monthly-summary-active .monthly-action-help{display:none!important}'
    + '.monthly-summary-notice{padding:12px;border:1px solid #cad9cf;background:#f1f6f2;margin:8px 0;font-size:13px;line-height:1.6}'
    + '.monthly-summary-table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}'
    + '.monthly-summary-table th,.monthly-summary-table td{padding:8px;border:1px solid #bbc5bd;text-align:right;white-space:nowrap}'
    + '.monthly-summary-table th{background:#e5eee7}.monthly-summary-table th:first-child,.monthly-summary-table td:first-child{text-align:left;white-space:normal;min-width:200px}'
    + '.monthly-summary-table td:last-child{font-weight:bold;background:#f1f6f2}'
    + '.report-focus #view-monthly.monthly-summary-active #monthly-summary-output{max-height:calc(100dvh - 88px);overflow:auto}'
    + '.report-focus #view-monthly.monthly-summary-active .sheet-scroll{height:auto}';
  document.head.appendChild(css);

  function range() {
    var preset = $('monthly-summary-preset').value, month = $('month').value;
    if (preset === 'custom') return { start: $('monthly-summary-start').value, end: $('monthly-summary-end').value };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('请先选择月份');
    var year = Number(month.slice(0, 4)), n = year * 12 + Number(month.slice(5)) - Number(preset);
    return preset === 'year' ? { start: year + '-01', end: year + '-12' }
      : { start: Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0'), end: month };
  }
  function validRange(r) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.end) || r.start > r.end)
      throw Error('请选择正确的起止月份');
    var count = (Number(r.end.slice(0, 4)) - Number(r.start.slice(0, 4))) * 12 + Number(r.end.slice(5)) - Number(r.start.slice(5)) + 1;
    if (count > 12) throw Error('一次最多汇总 12 个月，请缩短月份范围');
  }
  function notice(message, retry) {
    $('monthly-summary-status').textContent = message;
    $('monthly-summary-output').innerHTML = '<div class="monthly-summary-notice">' + esc(message)
      + (retry ? ' <button type="button" class="secondary" id="monthly-summary-retry">重试汇总</button>' : '') + '</div>';
    if (retry) $('monthly-summary-retry').onclick = refresh;
  }
  async function refresh() {
    var request = ++generation, store = currentStore(), month = $('month').value, r;
    function current() { return request === generation && state.monthlySummary.active && store === currentStore() && month === $('month').value; }
    try {
      r = range(); validRange(r);
      $('monthly-summary-start').value = r.start; $('monthly-summary-end').value = r.end;
      $('monthly-title').textContent = '月报汇总 · ' + store + ' · ' + r.start + ' 至 ' + r.end;
      notice('正在汇总 ' + r.start + ' 至 ' + r.end + '…');
      if (isLocalPreview()) { notice('本地预览不读取多月账本，请登录后使用汇总。'); return false; }
      var result = await api('monthly_summary', { store: store, start_month: r.start, end_month: r.end });
      if (!current()) return false;
      if (!Array.isArray(result.lines) || !Array.isArray(result.requested_months) || !Array.isArray(result.missing_months))
        throw Error('汇总数据格式未更新，请稍后重试');
      var missing = result.missing_months, months = result.requested_months;
      renderedScope = store + '|' + month;
      var message = '汇总范围：' + r.start + ' 至 ' + r.end + '；已汇总 ' + result.months.length + ' / ' + months.length + ' 个月。';
      if (missing.length) message += '缺少月报：' + missing.join('、') + '（未当作 0 元）。';
      notice(message);
      if (!result.months.length) { notice(message + '该范围暂无可汇总月报，请调整月份。'); return true; }
      if (!result.lines.length) { notice(message + '月报中暂无可汇总金额。'); return true; }
      var html = '<p class="help">只读汇总，不新增入账。各行分别合计，请勿将小计与明细再次相加。姓名／项目不同的行分开列出；“—”表示该月该项无数据，不代表 0 元。返回单月可查看原表和凭证。</p>'
        + '<div class="sheet-scroll"><table class="monthly-summary-table"><thead><tr><th>原表项目 / 单元格</th>'
        + months.map(function (m) { return '<th>' + esc(m) + (missing.indexOf(m) >= 0 ? '<br>缺月报' : '') + '</th>'; }).join('')
        + '<th>已有月份合计</th></tr></thead><tbody>';
      html += result.lines.map(function (line) {
        return '<tr><td>' + esc(line.label) + ' <small>[' + esc(line.address) + ']</small></td>'
          + months.map(function (m) { return '<td>' + (Object.prototype.hasOwnProperty.call(line.amounts, m) ? formatAmount(line.amounts[m]) : '—') + '</td>'; }).join('')
          + '<td>' + formatAmount(line.total) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      $('monthly-summary-output').insertAdjacentHTML('beforeend', html);
      applyReportFit();
      return true;
    } catch (error) {
      if (current()) notice('汇总未完成：' + error.message, true);
      return false;
    }
  }
  $('monthly-summary-toggle').addEventListener('click', async function () {
    var active = !(state.monthlySummary && state.monthlySummary.active);
    if (active && (Object.keys(state.monthlyDirty || {}).length || Object.keys(state.monthlyTextDirty || {}).length)) {
      toast('请先保存本月修改，再开启汇总'); return;
    }
    generation++;
    state.monthlySummary = { active: active };
    state.monthlyLoadRequest = (state.monthlyLoadRequest || 0) + 1;
    state.monthlyEditMode = false;
    closeMonthlyWorkbench();
    $('view-monthly').classList.toggle('monthly-summary-active', active);
    $('monthly-summary-output').classList.toggle('hidden', !active);
    $('monthly-summary-range').classList.toggle('hidden', !active);
    this.textContent = active ? '关闭汇总 · 返回单月' : '开启多月汇总';
    this.setAttribute('aria-pressed', String(active));
    if (active) {
      if (!$('monthly-summary-start').value) $('monthly-summary-start').value = $('month').value;
      if (!$('monthly-summary-end').value) $('monthly-summary-end').value = $('month').value;
      await refresh();
    } else {
      $('monthly-summary-output').innerHTML = ''; $('monthly-summary-status').textContent = '';
      $('monthly-sheet').innerHTML = '<div class="empty">正在返回单月报表…</div>';
      $('report-state').textContent = '';
      await loadOverview();
    }
  });
  $('monthly-summary-preset').addEventListener('change', function () {
    $('monthly-summary-custom').classList.toggle('hidden', this.value !== 'custom');
    // Invalidate outstanding requests immediately when the range changes.
    refresh();
  });
  ['monthly-summary-start', 'monthly-summary-end'].forEach(function (id) {
    $(id).addEventListener('change', function () { generation++; notice('月份范围已修改，请点击「汇总」。'); });
  });
  $('monthly-summary-apply').addEventListener('click', refresh);
  ['store-select', 'month'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (!(state.monthlySummary && state.monthlySummary.active)) return;
      generation++; renderedScope = '';
      notice('门店或月份已切换，请返回月报查看新的汇总。');
    }, true);
  });
  var originalShowView = showView;
  showView = async function (name) {
    var stale = name === 'monthly' && state.monthlySummary && state.monthlySummary.active
      && renderedScope !== currentStore() + '|' + $('month').value;
    if (stale) notice('正在读取所选门店的月报汇总…');
    await originalShowView(name);
    if (stale && state.view === 'monthly') await refresh();
  };
  window.ZysyrMonthlySummary = { refresh: refresh };
})();
