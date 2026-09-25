/* Fit the original report layout to the available width; browser zoom stays available. */
(function () {
  'use strict';
  var selector = '.sheet-scroll,.daily-grid-scroll,.archive-wrap,.salary-paper-scroll,.history-grid-wrap';
  var originals = new WeakMap(), widths = new WeakMap(), frame = 0;
  var pending = new Set(), pendingAll = false;
  function fitMonthlyAmounts(table) {
    // Fit complete amounts, never hide overflowing digits or shrink the whole
    // report's text. Re-measure after rotation, zoom and data replacement.
    var cells = table.querySelectorAll('td.monthly-daily-embedded:not(.monthly-daily-embedded-head)'), sizes = [];
    cells.forEach(function (cell) { cell.style.removeProperty('font-size'); });
    cells.forEach(function (cell) {
      if (!cell.textContent.trim()) return;
      var style = getComputedStyle(cell), box = cell.getBoundingClientRect();
      var zoom = box.width / cell.offsetWidth;
      var available = box.width - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)) * zoom;
      var range = document.createRange(); range.selectNodeContents(cell);
      var textWidth = range.getBoundingClientRect().width;
      if (available > 0 && textWidth > available) {
        sizes.push([cell, (Math.floor(parseFloat(style.fontSize) * available / textWidth * 98) / 100) + 'px']);
      }
    });
    sizes.forEach(function (item) { item[0].style.setProperty('font-size', item[1], 'important'); });
  }
  var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      var width = entry.target.clientWidth;
      if (widths.get(entry.target) !== width) { widths.set(entry.target, width); schedule([entry.target]); }
    });
  }) : null;
  function apply(targets) {
    var wrappers = targets ? Array.from(targets).filter(function (wrapper) {
      return wrapper && wrapper.matches && wrapper.matches(selector);
    }) : Array.from(document.querySelectorAll(selector));
    wrappers.forEach(function (wrapper) {
      var table = wrapper.querySelector('table');
      if (!table || !wrapper.getClientRects().length || wrapper.clientWidth <= 0) return;
      if (!originals.has(table)) originals.set(table, { width: table.style.width, zoom: table.style.zoom });
      var original = originals.get(table);
      table.style.zoom = '1';
      table.style.transform = '';
      table.style.width = original.width;
      var style = getComputedStyle(wrapper);
      var available = wrapper.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) - 2;
      var natural = Math.max(table.offsetWidth, table.scrollWidth);
      if (available <= 0 || natural <= 0) return;
      var scale = Math.min(1, available / natural);
      table.style.width = natural + 'px';
      if (table.classList.contains('sheet-table')) {
        // WebKit enforces a minimum rendered font size under CSS zoom, so it
        // can enlarge glyphs without enlarging these fixed columns. Scale the
        // laid-out monthly sheet as a whole instead, keeping every digit intact.
        fitMonthlyAmounts(table);
        var stage = table.parentElement;
        if (!stage.classList.contains('report-fit-stage')) {
          stage = document.createElement('div'); stage.className = 'report-fit-stage';
          table.parentElement.insertBefore(stage, table); stage.appendChild(table);
        }
        stage.style.cssText = 'position:relative;overflow:hidden;width:' + (natural * scale) + 'px;height:' + (table.offsetHeight * scale + 1) + 'px';
        table.style.position = 'absolute'; table.style.left = '0'; table.style.top = '0';
        table.style.transformOrigin = 'top left'; table.style.transform = 'scale(' + scale + ')';
        wrapper.scrollLeft = 0;
        if (observer && !widths.has(wrapper)) { widths.set(wrapper, wrapper.clientWidth); observer.observe(wrapper); }
        return;
      }
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
  function schedule(targets) {
    if (Array.isArray(targets) || targets instanceof Set) targets.forEach(function (target) { pending.add(target); });
    else pendingAll = true;
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      var all = pendingAll, targetsToApply = pending;
      pending = new Set(); pendingAll = false;
      apply(all ? null : targetsToApply);
    });
  }
  window.ZysyrReportFit = { apply: apply };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  function start() {
    function addAffected(node, includeDescendants) {
      var element = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!element) return;
      var owner = element.closest(selector);
      if (owner) pending.add(owner);
      if (includeDescendants && element.querySelectorAll) {
        element.querySelectorAll(selector).forEach(function (wrapper) { pending.add(wrapper); });
      }
    }
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        var subtreeMayChange = record.type === 'attributes';
        addAffected(record.target, subtreeMayChange);
        if (record.type === 'childList') record.addedNodes.forEach(function (node) { addAffected(node, true); });
      });
      if (pending.size) schedule(Array.from(pending));
    }).observe(document.getElementById('app') || document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    schedule();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
