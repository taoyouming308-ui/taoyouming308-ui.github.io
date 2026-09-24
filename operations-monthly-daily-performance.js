(function (root) {
  'use strict';

  var fields = [
    ['labor_performance', '劳动业绩', '日报“总计”'],
    ['cash_performance', '现金业绩', '日报“现金流”'],
    ['card_amount', '卡金', '日报“卡金消费”'],
    ['group_buy', '团购', '日报“团购”'],
    ['alipay', '支付宝', '日报“支付宝”'],
    ['wechat', '微信', '日报“微信”'],
    ['douyin', '抖音', '日报“抖音”']
  ];

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    var numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
  }

  function monthDays(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return 0;
    var parts = month.split('-');
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0)).getUTCDate();
  }

  function buildRows(month, performance) {
    var source = performance && Array.isArray(performance.rows) ? performance.rows : [];
    var byDate = new Map(source.map(function (row) { return [String(row.date || ''), row]; }));
    var count = monthDays(month), rows = [];
    for (var day = 1; day <= count; day++) {
      var date = month + '-' + String(day).padStart(2, '0'), sourceRow = byDate.get(date) || null;
      var row = { date: date, day: day, confirmed: Boolean(sourceRow), draft_id: sourceRow && sourceRow.draft_id || null,
        missing_fields: sourceRow && Array.isArray(sourceRow.missing_fields) ? sourceRow.missing_fields.slice() : [] };
      fields.forEach(function (field) { row[field[0]] = numberOrNull(sourceRow && sourceRow[field[0]]); });
      rows.push(row);
    }
    return rows;
  }

  function formatAmount(value) {
    var numeric = numberOrNull(value);
    if (numeric === null) return '—';
    return numeric.toFixed(2);
  }

  function totals(rows) {
    var output = {};
    fields.forEach(function (field) {
      output[field[0]] = Number(rows.reduce(function (sum, row) {
        return sum + (row.confirmed ? Number(row[field[0]] || 0) : 0);
      }, 0).toFixed(2));
    });
    return output;
  }

  function completeness(rows) {
    var days = Array.isArray(rows) ? rows : [];
    var confirmed = days.filter(function (row) { return row && row.confirmed; }).length;
    return { days: days.length, confirmed: confirmed, withoutConfirmedReport: Math.max(0, days.length - confirmed) };
  }

  function embeddedCell(cells, column, row) {
    return cells && cells[column + String(row)] || null;
  }

  function renderReadableDetails(container, rows) {
    if (!container || typeof document === 'undefined') return;
    container.replaceChildren();
    var summary = document.createElement('span');
    summary.className = 'monthly-daily-completeness-text';
    summary.textContent = rows.length
      ? '整月日报：已入账 ' + completeness(rows).confirmed + ' / ' + rows.length + ' 天；另有 ' + completeness(rows).withoutConfirmedReport + ' 天尚无已入账日报。未显示不代表休息日或零收入；合计只统计已入账日报。'
      : '整月日报：月份无效，暂无法显示日报覆盖情况。';
    container.appendChild(summary);
    if (!rows.length) return;

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'monthly-daily-details-toggle secondary';
    toggle.textContent = '清晰查看日报明细';
    toggle.setAttribute('aria-expanded', 'false');
    container.appendChild(toggle);

    var panel = document.createElement('section');
    panel.className = 'monthly-daily-details hidden';
    panel.setAttribute('aria-label', '整月日报明细');
    var label = document.createElement('label');
    label.textContent = '选择日期';
    var select = document.createElement('select');
    select.setAttribute('aria-label', '选择日报日期');
    rows.forEach(function (row, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = String(row.day).padStart(2, '0') + '日 · ' + (row.confirmed ? '已入账' : '未入账');
      select.appendChild(option);
    });
    var firstConfirmed = rows.findIndex(function (row) { return row.confirmed; });
    select.value = String(firstConfirmed >= 0 ? firstConfirmed : 0);
    label.appendChild(select);

    var dayStatus = document.createElement('p');
    dayStatus.className = 'monthly-daily-details-status';
    var grid = document.createElement('div');
    grid.className = 'monthly-daily-details-grid';
    panel.appendChild(label);
    panel.appendChild(dayStatus);
    panel.appendChild(grid);
    container.appendChild(panel);

    function updateDay() {
      var row = rows[Number(select.value)];
      if (!row) return;
      dayStatus.textContent = row.confirmed
        ? row.date + ' · 已入账' + (row.missing_fields.length ? ' · 有字段缺失：' + row.missing_fields.join('、') : ' · 数据来自已确认日报')
        : row.date + ' · 尚无已入账日报；以下“—”表示暂无已确认数据，不代表 0 元。';
      grid.replaceChildren();
      fields.forEach(function (field) {
        var item = document.createElement('div');
        item.className = 'monthly-daily-details-item';
        var name = document.createElement('span');
        name.textContent = field[1];
        var amount = document.createElement('strong');
        amount.textContent = row.confirmed ? formatAmount(row[field[0]]) : '—';
        item.appendChild(name);
        item.appendChild(amount);
        grid.appendChild(item);
      });
    }
    select.addEventListener('change', updateDay);
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = expanded ? '清晰查看日报明细' : '收起日报明细';
      panel.classList.toggle('hidden', expanded);
    });
    updateDay();
  }

  function resetEmbeddedCell(cell) {
    if (!cell) return;
    cell.textContent = '';
    cell.removeAttribute('data-trace-cell');
    cell.removeAttribute('data-monthly-daily-draft');
    cell.removeAttribute('data-report-date');
    cell.removeAttribute('role');
    cell.removeAttribute('tabindex');
    cell.removeAttribute('title');
    Array.from(cell.classList).filter(function (name) {
      return name === 'trace-cell' || name.indexOf('trace-') === 0 || name.indexOf('monthly-daily-embedded') === 0;
    }).forEach(function (name) { cell.classList.remove(name); });
  }

  function ensureDisplayColumns(cells) {
    if (embeddedCell(cells, 'W', 2)) return true;
    var anchor = embeddedCell(cells, 'V', 2);
    var table = anchor && anchor.closest ? anchor.closest('table') : null;
    if (!table) return false;
    var colgroup = table.querySelector('colgroup');
    if (colgroup) colgroup.appendChild(document.createElement('col'));
    Array.from(table.rows).forEach(function (row, index) {
      var cell = document.createElement('td');
      row.appendChild(cell);
      cells['W' + String(index + 1)] = cell;
    });
    return true;
  }

  function renderIntoSheet(options) {
    options = options || {};
    var cells = options.cells || {}, columns = ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
    if (!ensureDisplayColumns(cells)) return false;
    if (!columns.every(function (column) { return embeddedCell(cells, column, 2); })) return false;
    var performance = options.performance || {}, rows = buildRows(options.month, performance), total = totals(rows);
    if (options.completenessStatus) renderReadableDetails(options.completenessStatus, rows);
    var labels = ['日期'].concat(fields.map(function (field) { return field[1]; }));

    for (var rowNumber = 2; rowNumber <= 34; rowNumber++) {
      columns.forEach(function (column) { resetEmbeddedCell(embeddedCell(cells, column, rowNumber)); });
    }
    columns.forEach(function (column, index) {
      var cell = embeddedCell(cells, column, 2);
      cell.textContent = labels[index];
      cell.classList.add('monthly-daily-embedded', 'monthly-daily-embedded-head');
      cell.title = index === 0 ? '按自然日显示整月' : labels[index] + '：' + fields[index - 1][2] + '；只取已入账日报';
    });
    for (var slot = 0; slot < 31; slot++) {
      var source = rows[slot] || null, htmlRow = slot + 3;
      columns.forEach(function (column, index) {
        var cell = embeddedCell(cells, column, htmlRow);
        if (!cell) return;
        cell.classList.add('monthly-daily-embedded');
        if (!source) {
          cell.classList.add('monthly-daily-embedded-outside');
          return;
        }
        cell.textContent = index === 0 ? String(source.day).padStart(2, '0') + '日' : formatAmount(source[fields[index - 1][0]]);
        cell.classList.add(source.confirmed ? 'monthly-daily-embedded-confirmed' : 'monthly-daily-embedded-missing');
        cell.title = source.confirmed
          ? source.date + ' 已入账' + (source.missing_fields.length ? '；缺少：' + source.missing_fields.join('、') : '')
          : source.date + ' 尚无已入账日报';
        if (source.confirmed && source.draft_id && typeof options.onOpenDay === 'function') {
          cell.dataset.monthlyDailyDraft = source.draft_id;
          cell.dataset.reportDate = source.date;
          cell.tabIndex = 0;
          cell.setAttribute('role', 'button');
          cell.addEventListener('click', function () { options.onOpenDay(source.date, source.draft_id); });
          cell.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); cell.click(); }
          });
        }
      });
    }
    columns.forEach(function (column, index) {
      var cell = embeddedCell(cells, column, 34);
      if (!cell) return;
      cell.textContent = index === 0 ? '合计' : formatAmount(total[fields[index - 1][0]]);
      cell.classList.add('monthly-daily-embedded', 'monthly-daily-embedded-total');
      cell.title = '只合计当前门店已入账日报；草稿和识别候选不计入';
    });
    return true;
  }

  root.ZysyrMonthlyDailyPerformance = { buildRows: buildRows, totals: totals, completeness: completeness, renderIntoSheet: renderIntoSheet, fields: fields.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
