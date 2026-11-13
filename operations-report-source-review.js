/* Read-only source review. Never writes into the financial report or ledger. */
(function (root) {
  'use strict';
  if (root.StaffReportView && root.StaffReportView.enabled) return;
  var panels = [], scope = null, generation = 0;
  var escape = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function context() {
    var app = document.getElementById('app');
    return state.user && state.user.role === 'finance' && state.user.can_manage_finance_workbench
      && state.monthlyOverviewReady === true && app && !app.classList.contains('hidden')
      ? { actor: state.user, store: currentStore(), month: document.getElementById('month').value } : null;
  }
  function same(a, b) { return !!a && !!b && a.actor === b.actor && a.store === b.store && a.month === b.month; }
  function valueText(value) {
    if (value == null || value === '') return '—';
    return typeof value === 'number' ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(value);
  }
  function table(headers, rows) {
    return '<div style="overflow:auto;max-height:65vh"><table class="archive-table"' + (headers.length <= 3 ? ' style="min-width:0;width:100%;table-layout:fixed"' : '') + '><thead><tr>'
      + headers.map(function (h) { return '<th>' + escape(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>' + rows.map(function (row) { return '<tr>' + row.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function cellText(cell) {
    if (!cell) return '—';
    var details = cell.address + (cell.formula ? ' · 原公式：' + cell.formula : '')
      + (cell.value == null ? ' · 原件未保存数值' : ' · 原始保存值：' + cell.value);
    return '<span title="' + escape(details) + '">' + escape(valueText(cell.value)) + '</span>'
      + (cell.formula && cell.value == null ? '<small>（公式无缓存值）</small>' : '');
  }
  function grid(monthly) {
    var n = monthly.column_count || 0, headers = ['原行'], merged = {}, covered = {};
    function point(address) { var m = /^([A-Z]+)(\d+)$/.exec(address); if (!m) return null; return [Number(m[2]), m[1].split('').reduce(function (v, c) { return v * 26 + c.charCodeAt(0) - 64; }, 0)]; }
    (monthly.merges || []).forEach(function (range) {
      var parts = range.split(':'), a = point(parts[0]), b = point(parts[1] || parts[0]);
      if (!a || !b || b[0] > monthly.row_count || b[1] > n) return;
      merged[a.join(':')] = ' rowspan="' + (b[0] - a[0] + 1) + '" colspan="' + (b[1] - a[1] + 1) + '"';
      for (var r = a[0]; r <= b[0]; r++) for (var c = a[1]; c <= b[1]; c++) if (r !== a[0] || c !== a[1]) covered[r + ':' + c] = true;
    });
    for (var c = 1; c <= n; c++) { var label = '', x = c; while (x) { x--; label = String.fromCharCode(65 + x % 26) + label; x = Math.floor(x / 26); } headers.push(label); }
    var widths = Array.from({ length: n }, function (_, i) { return Math.max(72, Math.min(240, Number((monthly.column_widths || [])[i] || 12) * 8 + 16)); });
    return '<div style="overflow:auto;max-height:65vh"><table class="archive-table" style="table-layout:fixed;width:' + (48 + widths.reduce(function (a, b) { return a + b; }, 0)) + 'px"><colgroup><col style="width:48px">' + widths.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup><thead><tr>' + headers.map(function (h) { return '<th>' + escape(h) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + (monthly.rows || []).map(function (row) {
        var cells = '<th>' + escape(row.row) + '</th>';
        for (var c = 1; c <= n; c++) if (!covered[row.row + ':' + c]) cells += '<td' + (merged[row.row + ':' + c] || '') + '>' + cellText(row.cells.find(function (cell) { return cell.column === c; })) + '</td>';
        return '<tr>' + cells + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function render(panel, data) {
    if (data.status !== 'ready') {
      panel.body.textContent = data.message || (data.status === 'conflict' ? '本月存在多份来源，请先核对来源版本。' : '本月尚无可读取的来源。'); return;
    }
    var source = data.source || {}, monthly = data.monthly || {};
    var out = '<p class="help">' + escape(data.month) + ' · ' + escape(source.filename || '') + ' · 工作表「' + escape(source.worksheet_name || '')
      + '」</p><p class="help">以下为原件保存内容，待人工核对；公式未重新计算，空白不计为零。正式报表金额与入账状态保持原样。</p>';
    if (panel.kind === 'monthly') out += grid(monthly);
    else {
      out += '<h4>月报开支栏目 · 原件保存值</h4>';
      var expenseRows = monthly.expense_rows || [];
      out += expenseRows.length ? table(['原表位置', '栏目', '保存金额'], expenseRows.map(function (row) {
        var label = (row.cells || []).find(function (cell) { return cell.column === 2; });
        if (!label || label.value == null || label.value === '') label = (row.cells || []).find(function (cell) { return cell.column === 1; });
        var amount = (row.cells || []).find(function (cell) { return cell.column === 3; });
        return [escape(amount ? amount.address : row.row), escape(label ? label.value : row.label || ''), cellText(amount || row)];
      })) : '<p class="help">原件未提供可确定的开支栏目，请展开完整月报核对。</p>';
      out += '<h4>备用金来源明细' + (data.petty_cash_status === 'missing' ? ' · 尚无来源' : ' · ' + (data.expenses || []).length + ' 笔') + '</h4>';
      out += '<p class="help">备用金明细用于核对月报中的对应栏目，不与上方开支重复相加。</p>';
      out += table(['日期', '原凭证号', '说明', '科目', '收入保存值', '支出保存值', '来源位置', '核对状态', '入账状态'], (data.expenses || []).map(function (row) {
        var review = { pending: '待核对', unreviewed: '待核对', approved: '已审核', confirmed: '已确认', needs_correction: '待修正', rejected: '已退回' }[row.review_status] || '核对状态待核实';
        var posted = { pending: '未入账', staged: '未入账', imported: '已导入', posted: '已入账', failed: '导入失败' }[row.import_status] || '入账状态待核实';
        var locator = row.source_locator || '';
        if (locator && locator.indexOf('!') < 0) locator = (row.source_sheet || '') + '!' + locator;
        return [row.date, row.voucher_number, row.summary, row.category, valueText(row.inflow), valueText(row.outflow), locator, review, posted].map(escape);
      }));
      out += '<details style="margin-top:12px"><summary>展开完整月报原件内容</summary>' + grid(monthly) + '</details>';
    }
    if ((data.evidence || []).length) {
      out += '<h4>本月凭证原件包</h4><p class="help">整月留存，尚不代表每笔开支已匹配或审核通过。</p>'
        + data.evidence.map(function (file) { return '<div><button type="button" class="ghost" data-source-evidence="' + escape(file.id) + '">' + escape(file.filename) + ' · 整月原件</button>'
          + (file.matches_current_monthly_source === false ? '<span class="help">随旧版月报留存，与新版原件的对应关系待核对。</span>' : '') + '</div>'; }).join('');
    }
    out += '<details style="margin-top:12px"><summary>来源记录</summary><p class="help">原件 SHA256：' + escape(source.sha256 || '未提供') + '</p>'
      + (data.batches || []).map(function (batch) { return '<p class="help">' + escape(batch.filename) + ' · ' + escape(batch.id) + '</p>'; }).join('') + '</details>';
    panel.body.innerHTML = out;
    panel.body.querySelectorAll('[data-source-evidence]').forEach(function (button) {
      button.onclick = function () { if (same(scope, context())) openPrivate('history_import_file_url', { file_kind: 'evidence', id: button.dataset.sourceEvidence }); };
    });
  }
  async function read(panel) {
    sync(); var ctx = scope, token = generation, request = ++panel.request;
    if (!ctx) return;
    panel.button.disabled = true; panel.body.textContent = '正在读取本月已留存来源…';
    try {
      if (typeof isLocalPreview === 'function' && isLocalPreview()) throw Error('演示模式不读取真实原件');
      var data = await api('report_source_review', { store: ctx.store, month: ctx.month, kind: panel.kind });
      if (!same(ctx, context()) || token !== generation || request !== panel.request) return;
      if (!data || data.kind !== panel.kind || data.month !== ctx.month || data.financial_records_unchanged !== true) throw Error('来源范围未核实，请重新读取');
      render(panel, data);
    } catch (e) { if (same(ctx, context()) && token === generation && request === panel.request) panel.body.textContent = '来源暂时无法读取：' + e.message; }
    finally { if (request === panel.request) panel.button.disabled = false; }
  }
  function sync() {
    var next = context(); if (same(scope, next)) return;
    scope = next; generation++;
    panels.forEach(function (panel) { panel.request++; panel.host.classList.toggle('hidden', !next); panel.button.disabled = false; panel.body.textContent = next ? next.month + ' · 点击读取本月来源，可按原表核对。' : ''; });
  }
  [['monthly', 'view-monthly', '月报原件内容 · 待核对'], ['expenses', 'view-finance-workbench', '开支来源明细 · 待核对']].forEach(function (item) {
    var parent = document.getElementById(item[1]); if (!parent) return;
    var host = document.createElement('section'); host.className = 'panel hidden'; host.id = 'report-source-review-' + item[0]; host.style.marginTop = '16px';
    host.innerHTML = '<div class="finance-record-head"><h3>' + item[2] + '</h3><div class="compact-actions"><button type="button" class="secondary">读取本月来源</button>' + (item[0] === 'monthly' ? '<button type="button" class="ghost" data-source-go-expenses>查看本月开支来源</button>' : '') + '</div></div><div data-source-body role="region" aria-label="' + item[2] + '"></div>';
    parent.prepend(host);
    var panel = { kind: item[0], host: host, button: host.querySelector('button'), body: host.querySelector('[data-source-body]'), request: 0 };
    panel.button.onclick = function () { read(panel); }; panels.push(panel);
    var expenses = host.querySelector('[data-source-go-expenses]');
    if (expenses) expenses.onclick = async function () {
      if (!same(scope, context())) return;
      await openMonthlyPettyCashDetails();
      var target = panels.find(function (p) { return p.kind === 'expenses'; });
      if (state.view === 'finance-workbench' && target) read(target);
    };
  });
  ['month', 'store-select'].forEach(function (id) { var element = document.getElementById(id); if (element) element.addEventListener('change', sync); });
  var originalRender = root.renderAll; if (typeof originalRender === 'function') root.renderAll = function () { var result = originalRender.apply(this, arguments); sync(); return result; };
  new MutationObserver(sync).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['class'] });
  root.ZysyrReportSourceReview = { sync: sync }; sync();
})(window);
