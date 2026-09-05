/* Read-only voucher traversal. No accounting writes or persistent image cache. */
(function (root) {
  'use strict';
  function key(file) { return (file.evidence_source || 'history') + ':' + file.id; }
  function locators(file) {
    return Array.from(new Set([].concat(file.trace_source_locators || [], file.trace_source_locator || []).filter(Boolean)));
  }
  function merge(map, file) {
    var id = key(file), current = map.get(id);
    if (!current) { map.set(id, Object.assign({}, file)); return; }
    var merged = Object.assign({}, current, file, {
      trace_source_locators: Array.from(new Set(locators(current).concat(locators(file)))),
      trace_missing_exact_count: Math.max(Number(current.trace_missing_exact_count || 0), Number(file.trace_missing_exact_count || 0))
    });
    if (current.trace_link_level === 'bundle_only' || file.trace_link_level === 'bundle_only') merged.trace_link_level = 'bundle_only';
    map.set(id, merged);
  }
  async function collect(rootTrace, address, fetchTrace, options) {
    options = options || {};
    var limit = options.limit || 240, active = options.active || function () { return true; };
    var seen = new Set([address]), evidence = new Map(), queue = [], failures = [], leaves = 0, missingLeaves = 0, unresolved = 0;
    function accept(trace) {
      (trace.evidence || []).forEach(function (file) { merge(evidence, file); });
      if (trace.mode === 'formula') {
        var refs = (trace.precedents || []).map(function (cell) { return cell.cell_address; }).filter(Boolean);
        if (!refs.length) unresolved++;
        queue.push.apply(queue, refs);
      } else {
        leaves++;
        if (!(trace.evidence || []).length && Number((trace.target || {}).numeric_value)) missingLeaves++;
      }
    }
    accept(rootTrace);
    while (queue.length && active()) {
      var batch = [];
      while (queue.length && batch.length < 4 && seen.size < limit) {
        var next = queue.shift();
        if (seen.has(next)) continue;
        seen.add(next); batch.push(next);
      }
      if (!batch.length) break;
      await Promise.all(batch.map(async function (cell) {
        try { var trace = await fetchTrace(cell); if (active()) accept(trace); }
        catch (_) { failures.push(cell); }
      }));
    }
    return { evidence: Array.from(evidence.values()), leaf_count: leaves, missing_leaves: missingLeaves,
      failures: failures, unresolved: unresolved, truncated: queue.some(function (cell) { return !seen.has(cell); }), cancelled: !active() };
  }
  function selectImages(file) {
    var all = file.images || [], wanted = locators(file).map(function (value) { return String(value).split('/').pop(); });
    if (file.trace_link_level !== 'page_confirmed') return { images: all, missing: false };
    var found = all.filter(function (item) { return wanted.indexOf(String(item.filename || '').split('/').pop()) >= 0; });
    var missing = !wanted.length || wanted.some(function (name) { return !found.some(function (item) { return String(item.filename || '').split('/').pop() === name; }); });
    // Never silently substitute a whole bundle for a confirmed page.
    return { images: found, missing: missing };
  }
  function safeURL(value) {
    value = String(value || '');
    return /^https?:\/\//i.test(value) || /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value) ? value : '';
  }
  function kind(file) {
    var mime = file.mime_type || '', name = file.filename || file.original_filename || '';
    if (/^image\/(?:jpeg|png|webp|gif)$/i.test(mime) || /\.(?:jpe?g|png|webp|gif)$/i.test(name)) return 'image';
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    return 'file';
  }
  async function loadFiles(files, load, onFile, active) {
    var cursor = 0;
    await Promise.all([0, 1, 2].map(async function () {
      while (cursor < files.length && active()) {
        var index = cursor++, file = files[index], result;
        try { result = await load(file); }
        catch (error) { result = Object.assign({}, file, { preview_error: error.message || '读取失败' }); }
        if (active()) onFile(result, index);
      }
    }));
  }
  var api = { collect: collect, selectImages: selectImages, safeURL: safeURL, kind: kind, loadFiles: loadFiles, merge: merge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZysyrVoucherPreview = api;
})(typeof window !== 'undefined' ? window : globalThis);
