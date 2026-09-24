/* Fit the original report layout to the available width; browser zoom stays available. */
(function () {
  'use strict';
  var selector = '.sheet-scroll,.daily-grid-scroll,.archive-wrap,.salary-paper-scroll,.history-grid-wrap';
  var originals = new WeakMap(), widths = new WeakMap(), frame = 0;
  var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      var width = entry.target.clientWidth;
      if (widths.get(entry.target) !== width) { widths.set(entry.target, width); schedule(); }
    });
  }) : null;
  function apply() {
    document.querySelectorAll(selector).forEach(function (wrapper) {
      var table = wrapper.querySelector('table');
      if (!table || !wrapper.getClientRects().length || wrapper.clientWidth <= 0) return;
      if (!originals.has(table)) originals.set(table, { width: table.style.width, zoom: table.style.zoom });
      var original = originals.get(table);
      table.style.zoom = '1';
      table.style.width = original.width;
      var style = getComputedStyle(wrapper);
      var available = wrapper.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) - 2;
      var natural = Math.max(table.offsetWidth, table.scrollWidth);
      if (available <= 0 || natural <= 0) return;
      var scale = Math.min(1, available / natural);
      table.style.width = natural + 'px';
      table.style.zoom = String(scale);
      // Native date/select controls can increase an auto-layout table's minimum
      // width after zoom. Measure that final layout too, without clipping cells.
      for (var attempt = 0; attempt < 3; attempt++) {
        var rendered = Math.max(table.getBoundingClientRect().width, table.scrollWidth * scale);
        if (rendered <= available + 0.5) break;
        scale *= available / rendered;
        table.style.zoom = String(scale);
      }
      wrapper.scrollLeft = 0;
      if (observer && !widths.has(wrapper)) { widths.set(wrapper, wrapper.clientWidth); observer.observe(wrapper); }
    });
  }
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; apply(); });
  }
  window.ZysyrReportFit = { apply: apply };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  function start() {
    new MutationObserver(schedule).observe(document.getElementById('app') || document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    schedule();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
