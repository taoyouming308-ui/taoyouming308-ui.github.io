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
    var limit = Math.min(Number(options.limit) || 240, 240), maxDepth = Math.min(Number(options.maxDepth) || 24, 24);
    var batchSize = Math.max(1, Math.min(Number(options.batchSize) || 8, 8));
    var active = options.active || function () { return true; }, fetchTraceBatch = options.fetchTraceBatch;
    var seen = new Set([address]), evidence = new Map(), queue = [], failures = [], leaves = 0, missingLeaves = 0, unresolved = 0;
    var depthTruncated = false;
    function accept(trace, depth) {
      (trace.evidence || []).forEach(function (file) { merge(evidence, file); });
      if (trace.mode === 'formula') {
        var refs = (trace.precedents || []).map(function (cell) { return cell.cell_address; }).filter(Boolean);
        if (!refs.length) unresolved++;
        else if (depth >= maxDepth) depthTruncated = true;
        else refs.forEach(function (ref) { queue.push({ address: ref, depth: depth + 1 }); });
      } else {
        leaves++;
        if (!(trace.evidence || []).length && Number((trace.target || {}).numeric_value)) missingLeaves++;
      }
    }
    accept(rootTrace, 0);
    while (queue.length && active()) {
      var batch = [];
      while (queue.length && batch.length < batchSize && seen.size < limit) {
        var next = queue.shift();
        if (seen.has(next.address)) continue;
        seen.add(next.address); batch.push(next);
      }
      if (!batch.length) break;
      if (typeof fetchTraceBatch === 'function') {
        try {
          var traces = await fetchTraceBatch(batch.map(function (item) { return item.address; }));
          batch.forEach(function (item) {
            var result = traces && traces[item.address];
            if (!result || result.error) { failures.push(item.address); return; }
            if (active()) accept(result.trace || result, item.depth);
          });
        } catch (_) { failures.push.apply(failures, batch.map(function (item) { return item.address; })); }
      } else {
        await Promise.all(batch.map(async function (item) {
          try { var trace = await fetchTrace(item.address); if (active()) accept(trace, item.depth); }
          catch (_) { failures.push(item.address); }
        }));
      }
    }
    return { evidence: Array.from(evidence.values()), leaf_count: leaves, missing_leaves: missingLeaves,
      failures: failures, unresolved: unresolved, truncated: depthTruncated || queue.some(function (item) { return !seen.has(item.address); }), cancelled: !active() };
  }
  function selectImages(file) {
    var all = file.images || [], wanted = locators(file).map(function (value) { return String(value).split('/').pop(); });
    if (file.trace_link_level !== 'page_confirmed') return { images: all, missing: false };
    // A finance-uploaded file is itself the exact evidence. Its audit locator is
    // a hash marker rather than a path inside a DOCX package.
    if (all.length === 1 && wanted.length && wanted.every(function (name) { return /^manual-upload:/i.test(name); })) {
      return { images: all, missing: false };
    }
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
