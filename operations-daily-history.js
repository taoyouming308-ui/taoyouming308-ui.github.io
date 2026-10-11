/* Presentation only: audit data/loading and financial editing remain untouched. */
(function () {
  'use strict';
  var button = document.getElementById('daily-history-toggle');
  var body = document.getElementById('daily-history-body');
  var detail = document.getElementById('daily-report-detail');
  var view = document.getElementById('view-daily-report');
  if (!button || !body || !detail || !view) return;
  function setOpen(open) {
    body.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? '收起修改记录' : '查看修改记录';
  }
  function reset() { setOpen(false); }
  button.addEventListener('click', function () { setOpen(body.hidden); });
  ['store-select', 'month', 'daily-month'].forEach(function (id) {
    var element = document.getElementById(id);
    if (element) element.addEventListener('change', reset);
  });
  ['daily-month-prev', 'daily-month-next', 'daily-readonly-back'].forEach(function (id) {
    var element = document.getElementById(id);
    if (element) element.addEventListener('click', reset);
  });
  function syncAccess() {
    var allowed = !!(state.user && state.user.can_read_daily_history === true && state.imports.sheet && state.imports.sheet.permissions && state.imports.sheet.permissions.read_history === true);
    document.getElementById('daily-history-panel').hidden = !allowed;
    if (!allowed) {
      reset();
      document.getElementById('daily-detail-history').textContent = '';
      if (state.imports.sheet) delete state.imports.sheet.history;
    }
  }
  window.ZysyrDailyHistory = { syncAccess: syncAccess };
  function visible() { return !view.classList.contains('hidden') && !detail.classList.contains('hidden'); }
  var wasVisible = visible();
  var observer = new MutationObserver(function () {
    var nowVisible = visible();
    if (nowVisible !== wasVisible) reset();
    wasVisible = nowVisible;
  });
  observer.observe(view, { attributes: true, attributeFilter: ['class'] });
  observer.observe(detail, { attributes: true, attributeFilter: ['class'] });
  reset();
  syncAccess();
})();
