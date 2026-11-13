(function (global) {
  'use strict';

  // A display projection only. Archive presence never changes financial evidence or gates.
  function presence(value) {
    if (!value || typeof value !== 'object') return { state: 'legacy', count: null };
    if (value.state === 'archived' && Number.isInteger(value.count) && value.count > 0) {
      return { state: 'archived', count: value.count };
    }
    if (value.state === 'none' && value.count === 0) return { state: 'none', count: 0 };
    return { state: 'unavailable', count: null };
  }

  function privateLink(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function render(sheet, host, esc) {
    var state = presence(sheet.original_archive), date = sheet.draft && sheet.draft.report_date;
    // Never display an original under a different day's financial detail.
    var originals = state.state === 'archived' && Array.isArray(sheet.archived_originals)
      ? sheet.archived_originals.filter(function (item) { return item.report_date === date; }) : [];
    host.classList.toggle('hidden', state.state !== 'archived');
    host.innerHTML = state.state === 'archived'
      ? '<h4>独立存档原图 · 待核对</h4><div class="help">按门店和营业日期留存；存档不代表财务绑定或审核通过，金额与入账状态未调整。</div>'
        + originals.map(function (item) {
          var url = privateLink(item.private_url);
          return '<div class="finance-record" data-daily-archived-original="' + esc(item.request_id) + '"><div class="finance-record-head"><div><strong>'
            + esc(item.original_filename) + '</strong><div class="help">' + esc(item.report_date)
            + ' · 原图已存档 · 待核对</div></div><div class="compact-actions">'
            + (url ? '<a class="ghost" data-daily-archived-link href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">查看存档原图</a>'
              : '<span class="help">原图链接暂不可用，请刷新日报后重试。</span>')
            + '</div></div></div>';
        }).join('')
        + (originals.length ? '' : '<div class="help">原图已存档，明细暂不可用，请刷新日报后重试。</div>')
      : '';
    return state;
  }

  global.ZysyrDailyOriginalDisplay = Object.freeze({ presence: presence, render: render });
})(window);
