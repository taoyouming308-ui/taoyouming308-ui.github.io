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

  function render(options) {
    options = options || {};
    var container = options.container;
    if (!container || typeof document === 'undefined') return false;
    var performance = options.performance || {}, rows = buildRows(options.month, performance), total = totals(rows);
    container.replaceChildren();
    var summary = document.createElement('p');
    summary.className = 'monthly-daily-completeness-text';
    summary.textContent = '已入账日报 ' + completeness(rows).confirmed + ' / ' + rows.length + ' 天；未显示不代表休息日或零收入。合计只统计已入账日报。';
    container.appendChild(summary);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'monthly-daily-table-wrap';
    var table = document.createElement('table');
    table.className = 'monthly-daily-table';
    table.setAttribute('aria-label', '整月日报业绩明细');
    var head = document.createElement('thead'), headRow = document.createElement('tr');
    ['日期'].concat(fields.map(function (field) { return field[1]; })).forEach(function (label) {
      var cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; headRow.appendChild(cell);
    });
    head.appendChild(headRow); table.appendChild(head);
    var body = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.className = row.confirmed ? 'is-confirmed' : 'is-missing';
      var dateCell = document.createElement('th'); dateCell.scope = 'row';
      dateCell.textContent = String(row.day).padStart(2, '0') + '日';
      dateCell.title = row.confirmed ? row.date + ' · 已入账日报' : row.date + ' · 尚无已入账日报';
      if (row.confirmed && row.draft_id && typeof options.onOpenDay === 'function') {
        var link = document.createElement('button'); link.type = 'button'; link.className = 'monthly-daily-date-link';
        link.textContent = dateCell.textContent;
        link.addEventListener('click', function () { options.onOpenDay(row.date, row.draft_id); });
        dateCell.replaceChildren(link);
      }
      tr.appendChild(dateCell);
      fields.forEach(function (field) {
        var cell = document.createElement('td');
        cell.dataset.label = field[1];
        cell.textContent = row.confirmed ? formatAmount(row[field[0]]) : '—';
        cell.title = row.confirmed
          ? field[2] + (row.missing_fields.indexOf(field[0]) >= 0 ? ' · 原日报未提供此字段' : '')
          : '尚无已入账日报；不代表 0 元';
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    var totalRow = document.createElement('tr'); totalRow.className = 'monthly-daily-total';
    var totalLabel = document.createElement('th'); totalLabel.scope = 'row'; totalLabel.textContent = '合计'; totalRow.appendChild(totalLabel);
    fields.forEach(function (field) {
      var cell = document.createElement('td'); cell.textContent = formatAmount(total[field[0]]); totalRow.appendChild(cell);
    });
    body.appendChild(totalRow); table.appendChild(body); tableWrap.appendChild(table); container.appendChild(tableWrap);

    var mobileTotals = document.createElement('div'); mobileTotals.className = 'monthly-daily-mobile-totals';
    fields.forEach(function (field) {
      var item = document.createElement('div'); item.className = 'monthly-daily-mobile-total';
      var label = document.createElement('span'); label.textContent = field[1];
      var amount = document.createElement('strong'); amount.textContent = formatAmount(total[field[0]]);
      item.appendChild(label); item.appendChild(amount); mobileTotals.appendChild(item);
    });
    container.appendChild(mobileTotals);

    var cards = document.createElement('div'); cards.className = 'monthly-daily-mobile-cards';
    rows.forEach(function (row) {
      var card = document.createElement('section'); card.className = 'monthly-daily-mobile-card ' + (row.confirmed ? 'is-confirmed' : 'is-missing');
      var title = document.createElement('h3'); title.textContent = String(row.day).padStart(2, '0') + '日' + (row.confirmed ? ' · 已入账' : ' · 暂无日报');
      if (row.confirmed && row.draft_id && typeof options.onOpenDay === 'function') {
        title.replaceChildren(); var dayLink = document.createElement('button'); dayLink.type = 'button'; dayLink.className = 'monthly-daily-date-link';
        dayLink.textContent = title.textContent; dayLink.addEventListener('click', function () { options.onOpenDay(row.date, row.draft_id); }); title.appendChild(dayLink);
      }
      card.appendChild(title);
      var metrics = document.createElement('dl');
      fields.forEach(function (field) {
        var item = document.createElement('div'); item.className = 'monthly-daily-mobile-metric';
        var name = document.createElement('dt'); name.textContent = field[1];
        var value = document.createElement('dd'); value.textContent = row.confirmed ? formatAmount(row[field[0]]) : '—';
        item.appendChild(name); item.appendChild(value); metrics.appendChild(item);
      });
      card.appendChild(metrics); cards.appendChild(card);
    });
    container.appendChild(cards);
    return true;
  }

  root.ZysyrMonthlyDailyPerformance = { buildRows: buildRows, totals: totals, completeness: completeness, render: render, fields: fields.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
