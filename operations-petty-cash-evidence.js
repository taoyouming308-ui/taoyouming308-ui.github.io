/* Per-item petty-cash evidence. Whole-month bundles remain audit sources only. */
(function () {
  'use strict';
  if (typeof renderPettyCashReport !== 'function') return;

  var originalRender = renderPettyCashReport;
  var uploadGeneration = 0;
  var uploadBusy = false;
  var batchUploadBusy = false;
  var batchStatusData = null;
  var batchStatusKey = '';
  var batchDrafts = {};
  var batchPollTimer = 0;
  var batchLastWakeAt = 0;
  var batchLoadGeneration = 0;
  var batchUploadSummaryText = '';
  var batchUploadSummaryKey = '';

  function styleOnce() {
    if (document.getElementById('petty-evidence-style')) return;
    var style = document.createElement('style');
    style.id = 'petty-evidence-style';
    style.textContent = [
      '.petty-evidence-panel{overflow:hidden}',
      '.petty-evidence-stats{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}',
      '.petty-evidence-stats span{padding:7px 10px;border-radius:999px;background:#eceae4;font-size:12px}',
      '.petty-evidence-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.petty-evidence-item{border:1px solid var(--line);border-radius:12px;background:#fff;padding:12px;min-width:0}',
      '.petty-evidence-item.missing{border-color:#d99d90;background:#fff9f7}',
      '.petty-evidence-item-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}',
      '.petty-evidence-item-head strong{font-size:14px}',
      '.petty-evidence-item-head small{display:block;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}',
      '.petty-evidence-amount{white-space:nowrap;color:#173e32;font-size:16px}',
      '.petty-evidence-status{margin:10px 0 8px;padding:7px 9px;border-radius:8px;background:#e8f3ed;color:#185b37;font-size:12px;font-weight:700}',
      '.petty-evidence-item.missing .petty-evidence-status{background:#f7dfda;color:#8d2f25}',
      '.petty-evidence-actions{display:flex;gap:7px;flex-wrap:wrap}',
      '.petty-evidence-actions button{min-height:38px}',
      '.petty-upload-preview img{display:block;width:100%;max-height:46vh;object-fit:contain;background:#eceae4;border-radius:10px}',
      '.petty-upload-preview iframe{display:block;width:100%;height:46vh;border:1px solid var(--line);border-radius:10px;background:#fff}',
      '.petty-row-evidence{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:5px}',
      '.petty-evidence-badge{font-size:11px;font-weight:700;color:#185b37}',
      '.petty-evidence-badge.missing{color:#8d2f25}',
      '.petty-batch-panel{margin:0 0 14px;border:2px solid #b17618;background:#fffaf0}',
      '.petty-batch-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}',
      '.petty-batch-head h3{margin:0 0 5px;color:#173e32}',
      '.petty-batch-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.petty-batch-primary{background:#a96912!important;color:#fff!important;border-color:#a96912!important;font-weight:800}',
      '.petty-batch-status{margin-top:10px;padding:10px 12px;border-radius:10px;background:#f2ead9;color:#594318;font-weight:700}',
      '.petty-batch-summary{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
      '.petty-batch-summary span{padding:6px 9px;border-radius:999px;background:#fff;border:1px solid #d9c7a6;font-size:12px}',
      '.petty-batch-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}',
      '.petty-batch-item{border:1px solid #d9c7a6;border-radius:12px;background:#fff;padding:12px;min-width:0}',
      '.petty-batch-item.confirmed{border-color:#8bb79e;background:#f4fbf7}',
      '.petty-batch-file{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}',
      '.petty-batch-file strong{overflow-wrap:anywhere}',
      '.petty-batch-chip{white-space:nowrap;border-radius:999px;padding:4px 7px;background:#eee8dd;font-size:11px;font-weight:800}',
      '.petty-batch-chip.good{background:#dcefe3;color:#185b37}',
      '.petty-batch-chip.warn{background:#f8dfd8;color:#8d2f25}',
      '.petty-batch-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}',
      '.petty-batch-fields label{font-size:11px;font-weight:800;color:var(--muted)}',
      '.petty-batch-fields input,.petty-batch-fields select{width:100%;min-width:0;margin-top:3px}',
      '.petty-batch-target{grid-column:1/-1}',
      '.petty-batch-match{margin:9px 0;font-size:12px;color:#5f563f}',
      '.petty-batch-item-actions{display:flex;justify-content:flex-end;gap:8px;align-items:center;flex-wrap:wrap}',
      '@media(max-width:760px){.petty-evidence-list,.petty-batch-list{grid-template-columns:1fr}.petty-evidence-item,.petty-batch-item{padding:11px}.petty-evidence-actions button,.petty-batch-actions button{flex:1 1 140px}.petty-evidence-item-head{gap:8px}.petty-batch-fields{grid-template-columns:1fr}.petty-batch-target{grid-column:auto}}'
    ].join('');
    document.head.appendChild(style);
  }

  function exactHistoryLinks(row, data) {
    return (data.history_evidence_links || []).filter(function (link) {
      return link.import_row_id === row.import_row_id && link.link_level !== 'bundle_only';
    });
  }

  function historyFiles(row, data) {
    var links = exactHistoryLinks(row, data), files = data.history_evidence || [];
    return files.filter(function (file) {
      return links.some(function (link) { return link.evidence_id === file.id; });
    }).map(function (file) {
      var fileLinks = links.filter(function (link) { return link.evidence_id === file.id; });
      return Object.assign({}, file, {
        trace_link_level: 'page_confirmed',
        trace_source_locator: fileLinks[0] && fileLinks[0].source_locator,
        trace_source_locators: fileLinks.map(function (link) { return link.source_locator; }).filter(Boolean),
        trace_missing_exact_count: 0
      });
    });
  }

  function removeLegacyHistoryPanel(container) {
    Array.from(container.children).forEach(function (node) {
      var title = node.querySelector && node.querySelector('h3');
      if (title && title.textContent.trim() === '历史正式备用金明细') node.remove();
    });
  }

  function historyCard(row, data, canUpload) {
    var files = historyFiles(row, data), count = files.length, missing = !count;
    return '<article class="petty-evidence-item' + (missing ? ' missing' : '') + '" data-history-petty-card="' + esc(row.id) + '">'
      + '<div class="petty-evidence-item-head"><div><strong>' + esc(row.transaction_date) + ' · ' + esc(row.summary) + '</strong>'
      + '<small>编号 ' + esc(row.voucher_number || '—') + ' · ' + esc(row.category || '未分类') + ' · 原表 ' + esc(row.source_locator || '—') + '</small></div>'
      + '<strong class="petty-evidence-amount">' + formatAmount(row.amount) + '</strong></div>'
      + '<div class="petty-evidence-status">' + (count ? '已精确对应本笔消费凭证 ' + count + ' 份' : '缺少与本笔精确对应的消费凭证') + '</div>'
      + '<div class="petty-evidence-actions"><button type="button" class="' + (count ? 'primary' : 'secondary') + '" data-history-petty-open="' + esc(row.id) + '">' + (count ? '查看本笔凭证' : '查看明细') + '</button>'
      + (canUpload ? '<button type="button" class="secondary" data-petty-exact-upload="history" data-record-id="' + esc(row.id) + '">' + (count ? '补传本笔凭证' : '上传本笔凭证') + '</button>' : '')
      + '</div></article>';
  }

  function renderHistoryEvidence(data) {
    var container = document.getElementById('petty-cash-report-table');
    if (!container) return;
    removeLegacyHistoryPanel(container);
    var records = (data.history_records || []).filter(function (row) { return row.direction === 'outflow'; });
    if (!records.length) return;
    var canUpload = Boolean(data.permissions && data.permissions.upload_history_evidence);
    var exact = records.filter(function (row) { return historyFiles(row, data).length; }).length;
    var total = records.reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0);
    var panel = document.createElement('section');
    panel.className = 'panel petty-evidence-panel';
    panel.innerHTML = '<div class="finance-record-head"><div><h3>历史正式备用金 · 逐笔消费凭证</h3>'
      + '<div class="help">每一项只显示与本条记录精确关联的原图；整月 Word 凭证包继续永久留底，但不再冒充单笔凭证。</div></div>'
      + '<strong>支出合计 ' + formatAmount(total) + '</strong></div>'
      + '<div class="petty-evidence-stats"><span>明细 ' + records.length + ' 笔</span><span>凭证已对应 ' + exact + ' 笔</span><span>待补 ' + (records.length - exact) + ' 笔</span></div>'
      + '<div class="petty-evidence-list">' + records.map(function (row) { return historyCard(row, data, canUpload); }).join('') + '</div>';
    container.appendChild(panel);
  }

  function enhanceFormalEvidence(data) {
    var records = data.records || [], links = data.voucher_links || [], pending = data.pending_voucher_requests || [];
    var canUpload = Boolean(data.permissions && data.permissions.upload_voucher);
    records.forEach(function (row) {
      var trace = document.querySelector('[data-petty-trace="' + row.id + '"]');
      var tableRow = trace && trace.closest('tr');
      if (!tableRow || tableRow.dataset.evidenceEnhanced === 'true') return;
      tableRow.dataset.evidenceEnhanced = 'true';
      var count = links.filter(function (link) { return link.business_id === row.id && link.business_type === 'petty_cash_record'; }).length;
      var waiting = pending.some(function (request) { return request.business_id === row.id && request.business_type === 'petty_cash_record'; });
      var cell = tableRow.cells[1], actions = document.createElement('div');
      actions.className = 'petty-row-evidence';
      actions.innerHTML = '<span class="petty-evidence-badge' + (!count && !waiting ? ' missing' : '') + '">'
        + (count ? '已对应 ' + count + ' 份' : waiting ? '已上传，等待审核' : '缺少本笔凭证') + '</span>'
        + (canUpload && !waiting ? '<button type="button" class="ghost" data-petty-exact-upload="formal" data-record-id="' + esc(row.id) + '">' + (count ? '补传' : '上传本笔凭证') + '</button>' : '');
      cell.appendChild(actions);
      var open = tableRow.querySelector('[data-ledger-voucher-open]');
      if (open) open.textContent = '查看本笔凭证';
    });
  }

  function exactHistoryImageFilename(file) {
    return window.ZysyrVoucherPreview.exactImageFilenames(file)[0] || null;
  }

  async function loadHistoryFile(file, host) {
    function retry() { host.innerHTML = '<div class="help">正在重新读取本笔凭证…</div>'; loadHistoryFile(file, host); }
    try {
      var result = await api('history_evidence_images', { store: currentStore(), evidence_id: file.id, image_filename: exactHistoryImageFilename(file) || undefined });
      monthlyVoucherView.fileView(Object.assign({}, file, result), host, retry, null, function (sourceFile, imageFilename) {
        return api('history_evidence_images', { store: currentStore(), evidence_id: file.id, image_filename: imageFilename });
      });
    } catch (error) {
      monthlyVoucherView.fileView(Object.assign({}, file, { preview_error: error.message }), host, retry, null, function (sourceFile, imageFilename) {
        return api('history_evidence_images', { store: currentStore(), evidence_id: file.id, image_filename: imageFilename });
      });
    }
  }

  function openHistoryPetty(recordId) {
    var data = state.pettyCash.data || {};
    var row = (data.history_records || []).find(function (item) { return item.id === recordId; });
    if (!row) return;
    var files = historyFiles(row, data), canUpload = Boolean(data.permissions && data.permissions.upload_history_evidence);
    document.getElementById('trace-backdrop').classList.remove('hidden');
    document.getElementById('trace-backdrop').setAttribute('aria-hidden', 'false');
    document.getElementById('trace-content').innerHTML = '<div class="trace-card"><h4>' + esc(row.transaction_date) + ' · ' + esc(row.summary) + '</h4>'
      + '<div class="trace-row"><span>' + esc(row.category || '未分类') + ' · 编号 ' + esc(row.voucher_number || '—') + '</span><strong>' + formatAmount(row.amount) + '</strong></div>'
      + '<div class="help">原表位置 ' + esc(row.source_locator || '—') + ' · 正式账 v' + esc(row.version) + '</div></div>'
      + '<div class="trace-card"><div class="finance-record-head"><div><h4>本笔消费凭证</h4><div class="help">只显示与当前这一笔精确对应的原图。</div></div>'
      + (canUpload ? '<button type="button" class="secondary" data-petty-exact-upload="history" data-record-id="' + esc(row.id) + '">' + (files.length ? '补传本笔凭证' : '上传本笔凭证') + '</button>' : '') + '</div>'
      + '<div id="history-petty-file-list">' + (files.length ? '' : '<div class="candidate-warning">当前这一笔没有精确对应的消费凭证，请由财务在这里补传。</div>') + '</div></div>';
    var list = document.getElementById('history-petty-file-list');
    files.forEach(function (file) {
      var host = document.createElement('section');
      host.className = 'voucher-file-preview';
      host.innerHTML = '<div class="help">正在读取本笔凭证原图…</div>';
      list.appendChild(host);
      loadHistoryFile(file, host);
    });
    bindUploadButtons();
  }

  function selectedRecord(kind, id) {
    var data = state.pettyCash.data || {};
    return (kind === 'history' ? data.history_records || [] : data.records || []).find(function (row) { return row.id === id; });
  }

  function showUploadConfirmation(kind, row, file) {
    var generation = ++uploadGeneration;
    var url = URL.createObjectURL(file);
    var backdrop = document.getElementById('trace-backdrop');
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    var label = row.transaction_date + ' · ' + row.summary + ' · ' + formatAmount(row.amount);
    document.getElementById('trace-content').innerHTML = '<div class="trace-card"><h4>确认上传到这一笔</h4><div class="trace-row"><span>' + esc(label) + '</span><strong>' + esc(kind === 'history' ? '历史正式账' : '当前备用金记录') + '</strong></div>'
      + '<div class="petty-upload-preview">' + (file.type === 'application/pdf' ? '<iframe title="待上传消费凭证" src="' + esc(url) + '"></iframe>' : '<img alt="待上传消费凭证" src="' + esc(url) + '">') + '</div>'
      + '<div class="help">' + esc(file.name) + ' · 尚未上传。确认后只绑定当前这一笔，不改变金额，也不会自动入账。</div>'
      + '<div class="field"><label for="petty-upload-reason">上传说明（永久留痕）</label><input id="petty-upload-reason" maxlength="500" value="补充 ' + esc(row.transaction_date + ' ' + row.summary) + ' 的消费凭证"></div>'
      + '<div class="trace-actions"><button id="petty-upload-confirm" type="button" class="primary">确认上传本笔凭证</button><button id="petty-upload-cancel" type="button" class="ghost">取消</button></div>'
      + '<div id="petty-upload-status" class="help" role="status"></div></div>';
    document.getElementById('petty-upload-cancel').onclick = function () {
      uploadGeneration++;
      URL.revokeObjectURL(url);
      closeTrace();
    };
    document.getElementById('petty-upload-confirm').onclick = async function () {
      var reason = document.getElementById('petty-upload-reason').value.trim();
      var status = document.getElementById('petty-upload-status');
      if (!reason) { status.textContent = '请填写上传说明。'; return; }
      if (uploadBusy) { status.textContent = '正在上传，请勿重复点击。'; return; }
      uploadBusy = true;
      document.getElementById('petty-upload-confirm').disabled = true;
      document.getElementById('petty-upload-cancel').disabled = true;
      status.textContent = '正在上传并精确绑定当前这一笔，请勿重复点击…';
      document.getElementById('finance-workbench-status').textContent = status.textContent;
      try {
        if (isLocalPreview()) throw new Error('本地预览不写入数据库');
        var common = { store: currentStore(), filename: file.name, mime_type: file.type, base64: await fileBase64(file), reason: reason };
        if (generation !== uploadGeneration) return;
        if (kind === 'history') {
          await api('history_ledger_evidence_upload', Object.assign(common, { ledger_entry_id: row.id }));
        } else {
          await api('voucher_upload', Object.assign(common, {
            record_type: 'unassigned', record_id: null, business_type: 'petty_cash_record', business_id: row.id,
            business_link_reason: reason, skip_ocr: true, note: reason
          }));
        }
        var successMessage = kind === 'history' ? '上传成功，已直接对应到这一笔。' : '上传成功，正在等待财务审核；审核通过后自动对应到这一笔。';
        status.textContent = successMessage;
        document.getElementById('finance-workbench-status').textContent = successMessage;
        toast(successMessage);
        await loadPettyCashReport();
        document.getElementById('finance-workbench-status').textContent = successMessage;
        if (kind === 'history' && generation === uploadGeneration) openHistoryPetty(row.id);
      } catch (error) {
        status.textContent = '上传失败或状态未确认：' + error.message + '。请先刷新查看，确认没有新增后再重试。';
        document.getElementById('finance-workbench-status').textContent = status.textContent;
      } finally {
        uploadBusy = false;
        URL.revokeObjectURL(url);
        var confirm = document.getElementById('petty-upload-confirm');
        var cancel = document.getElementById('petty-upload-cancel');
        if (confirm) confirm.disabled = false;
        if (cancel) cancel.disabled = false;
      }
    };
  }

  function beginUpload(kind, recordId) {
    if (uploadBusy) { toast('当前已有凭证正在上传，请稍候'); return; }
    var row = selectedRecord(kind, recordId);
    if (!row) { toast('没有找到这笔备用金明细，请刷新后重试'); return; }
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,application/pdf';
    picker.onchange = function () {
      var file = picker.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
        toast('请选择 10MB 以内的 JPG、PNG 或 PDF');
        return;
      }
      showUploadConfirmation(kind, row, file);
    };
    picker.click();
  }

  function hideLegacyPettyActions() {
    var buttons = ['finance-open-upload', 'finance-ledger-refresh'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
    buttons.forEach(function (button) { button.remove(); });
    var head = document.querySelector('#petty-cash-report-summary .finance-record-head');
    if (head) Array.from(head.querySelectorAll('.compact-actions')).forEach(function (actions) {
      if (!actions.children.length) actions.remove();
    });
  }

  function currentBatchKey() {
    return currentStore() + '|' + document.getElementById('month').value;
  }

  function batchTargetValue(kind, id) {
    return (kind || '') + ':' + (id || '');
  }

  function rememberBatchDrafts() {
    document.querySelectorAll('[data-petty-batch-item]').forEach(function (card) {
      var id = card.dataset.pettyBatchItem;
      var date = card.querySelector('[data-batch-date]');
      var amount = card.querySelector('[data-batch-amount]');
      var counterparty = card.querySelector('[data-batch-counterparty]');
      var number = card.querySelector('[data-batch-number]');
      var target = card.querySelector('[data-batch-target]');
      if (!id || !date || !amount || !target) return;
      batchDrafts[id] = { document_date: date.value, amount: amount.value,
        counterparty: counterparty ? counterparty.value : '', document_number: number ? number.value : '', target: target.value };
    });
  }

  function batchStatusText(item) {
    if (item.confirmed_target_id) return { label: '已确认对应', className: 'good' };
    if (item.task_status === 'queued' || item.task_status === 'processing') return { label: '正在识别', className: '' };
    if (item.match && item.match.state === 'exact') return { label: '已识别，可确认', className: 'good' };
    if (item.task_status === 'failed') return { label: '需人工核对', className: 'warn' };
    return { label: '待人工选择', className: 'warn' };
  }

  function batchTargetOptions(targets, selected) {
    var formal = targets.filter(function (target) { return target.target_kind === 'formal'; });
    var history = targets.filter(function (target) { return target.target_kind === 'history'; });
    function options(rows) {
      return rows.map(function (target) {
        var value = batchTargetValue(target.target_kind, target.id);
        var text = target.transaction_date + ' · ' + (target.summary || target.category || '备用金支出') + ' · ¥' + formatAmount(target.amount)
          + (target.voucher_number ? ' · 凭-' + target.voucher_number : '');
        return '<option value="' + esc(value) + '" ' + (value === selected ? 'selected' : '') + '>' + esc(text) + '</option>';
      }).join('');
    }
    return '<option value="">请选择对应明细</option>'
      + (formal.length ? '<optgroup label="当前电子备用金明细">' + options(formal) + '</optgroup>' : '')
      + (history.length ? '<optgroup label="历史正式备用金明细">' + options(history) + '</optgroup>' : '');
  }

  function renderBatchItems(data) {
    var list = document.getElementById('petty-batch-list');
    if (!list) return;
    rememberBatchDrafts();
    var items = data.items || [], targets = data.targets || [];
    if (!items.length) {
      list.innerHTML = '<div class="help">本月还没有批量上传的凭证。可以一次选择整月 JPG、PNG 或 PDF。</div>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      var fields = item.confirmed_target_id ? (item.corrected_fields || item.candidate_fields || {}) : (item.candidate_fields || {});
      var suggested = item.match && item.match.target_id ? batchTargetValue(item.match.target_kind, item.match.target_id) : '';
      var confirmed = item.confirmed_target_id ? batchTargetValue(item.confirmed_target_kind, item.confirmed_target_id) : '';
      var draft = batchDrafts[item.id] || { document_date: fields.document_date || '', amount: fields.amount == null ? '' : fields.amount,
        counterparty: fields.counterparty || '', document_number: fields.document_number || '', target: confirmed || suggested };
      batchDrafts[item.id] = draft;
      var status = batchStatusText(item), disabled = item.confirmed_target_id ? 'disabled' : '';
      var recognizing = item.task_status === 'queued' || item.task_status === 'processing';
      var error = item.latest_ocr_task && item.latest_ocr_task.error_message;
      var reason = item.match && item.match.reason ? item.match.reason : '等待识别结果';
      if (error === 'PDF_REQUIRES_MANUAL_REVIEW') reason = 'PDF 原件已保存，请人工填写日期、金额并选择对应明细';
      return '<article class="petty-batch-item' + (item.confirmed_target_id ? ' confirmed' : '') + '" data-petty-batch-item="' + esc(item.id) + '" data-batch-id="' + esc(item.batch_id) + '">'
        + '<div class="petty-batch-file"><div><strong>' + esc(item.original_filename) + '</strong><div class="help">上传 ' + esc(window.ZysyrTime.dateTime(item.uploaded_at)) + '</div></div>'
        + '<span class="petty-batch-chip ' + status.className + '">' + esc(status.label) + '</span></div>'
        + '<div class="petty-batch-match">' + esc(reason) + '</div>'
        + '<div class="petty-batch-fields"><label>凭证日期<input data-batch-date type="date" value="' + esc(draft.document_date) + '" ' + disabled + '></label>'
        + '<label>凭证金额<input data-batch-amount type="number" min="0.01" step="0.01" value="' + esc(draft.amount) + '" ' + disabled + '></label>'
        + '<label>商户 / 收款方<input data-batch-counterparty type="text" maxlength="200" value="' + esc(draft.counterparty) + '" ' + disabled + '></label>'
        + '<label>票据号（可选）<input data-batch-number type="text" maxlength="120" value="' + esc(draft.document_number) + '" ' + disabled + '></label>'
        + '<label class="petty-batch-target">对应备用金明细<select data-batch-target ' + disabled + '>' + batchTargetOptions(targets, draft.target) + '</select></label></div>'
        + '<div class="petty-batch-item-actions"><button type="button" class="ghost" data-petty-batch-open="' + esc(item.id) + '">查看原图</button>'
        + (item.confirmed_target_id ? '<span class="petty-evidence-badge">原图已逐笔关联，金额未改变</span>'
          : '<button type="button" class="primary" data-petty-batch-confirm="' + esc(item.id) + '" ' + (recognizing ? 'disabled' : '') + '>' + (recognizing ? '识别中…' : '确认本张并对应') + '</button>')
        + '</div></article>';
    }).join('');
    bindBatchItemActions();
  }

  function renderBatchStatus(data) {
    var status = document.getElementById('petty-batch-status');
    var summary = document.getElementById('petty-batch-summary');
    if (!status || !summary) return;
    var stats = data.summary || {};
    status.textContent = stats.total
      ? '已读取本月批量凭证。识别结果只是候选，请核对原图后确认对应关系。'
      : '可一次选择整月凭证；上传后自动识别日期和金额，并建议对应到本月明细。';
    if (batchUploadSummaryText && batchUploadSummaryKey === currentBatchKey()) status.textContent += '\n' + batchUploadSummaryText;
    summary.innerHTML = '<span>已上传 ' + Number(stats.total || 0) + '</span><span>识别中 ' + Number(stats.recognizing || 0)
      + '</span><span>明确匹配 ' + Number(stats.ready || 0) + '</span><span>待人工核对 ' + Number(stats.needs_review || 0)
      + '</span><span>已确认 ' + Number(stats.confirmed || 0) + '</span>';
    var confirmExact = document.getElementById('petty-batch-confirm-exact');
    if (confirmExact) confirmExact.disabled = !Number(stats.ready || 0) || batchUploadBusy;
    renderBatchItems(data);
  }

  function scheduleBatchPoll(data) {
    clearTimeout(batchPollTimer);
    if (!data || !data.summary || !Number(data.summary.recognizing || 0)) return;
    batchPollTimer = setTimeout(async function () {
      if (Date.now() - batchLastWakeAt > 30000 && !batchUploadBusy) {
        batchLastWakeAt = Date.now();
        try { await api('voucher_ocr_wake', { store: currentStore(), limit: 5 }); } catch (_) {}
      }
      loadBatchStatus();
    }, 8000);
  }

  async function loadBatchStatus(batchId) {
    var panel = document.getElementById('petty-batch-panel');
    if (!panel) return;
    var generation = ++batchLoadGeneration;
    var month = document.getElementById('month').value;
    var status = document.getElementById('petty-batch-status');
    if (status && !batchStatusData) status.textContent = '正在读取本月批量凭证状态…';
    if (isLocalPreview()) {
      batchStatusData = { month: month, items: [], targets: [], summary: { total: 0, recognizing: 0, ready: 0, needs_review: 0, confirmed: 0 } };
      batchStatusKey = currentBatchKey();
      renderBatchStatus(batchStatusData);
      return;
    }
    try {
      var data = await api('petty_cash_batch_status', { store: currentStore(), month: month, batch_id: batchId || null });
      if (generation !== batchLoadGeneration || month !== document.getElementById('month').value) return;
      batchStatusData = data;
      batchStatusKey = currentBatchKey();
      renderBatchStatus(data);
      scheduleBatchPoll(data);
    } catch (error) {
      if (status) status.textContent = '批量凭证状态读取失败：' + error.message;
    }
  }

  function insertBatchPanel(data) {
    var container = document.getElementById('petty-cash-report-table');
    if (!container || !(data.permissions && data.permissions.batch_voucher)) return;
    var panel = document.createElement('section');
    panel.id = 'petty-batch-panel';
    panel.className = 'panel petty-batch-panel';
    panel.innerHTML = '<div class="petty-batch-head"><div><h3>本月消费凭证批量上传</h3><div class="help">适合月底一次上传。支持多选 JPG、PNG、PDF；原件先留存并自动识别，财务确认后才逐笔对应，不改金额、不自动入账。</div></div>'
      + '<div class="petty-batch-actions"><button id="petty-batch-select" type="button" class="petty-batch-primary">＋ 批量上传本月凭证</button>'
      + '<button id="petty-batch-refresh" type="button" class="secondary">刷新识别状态</button>'
      + '<button id="petty-batch-confirm-exact" type="button" class="secondary" disabled>确认全部明确匹配</button></div></div>'
      + '<input id="petty-batch-files" type="file" accept="image/jpeg,image/png,application/pdf" multiple hidden>'
      + '<div id="petty-batch-status" class="petty-batch-status" role="status">正在准备批量凭证区…</div>'
      + '<div id="petty-batch-summary" class="petty-batch-summary"></div><div id="petty-batch-list" class="petty-batch-list"></div>';
    container.insertBefore(panel, container.firstChild);
    document.getElementById('petty-batch-select').onclick = function () { document.getElementById('petty-batch-files').click(); };
    document.getElementById('petty-batch-files').onchange = function (event) { uploadBatchFiles(Array.from(event.target.files || [])); event.target.value = ''; };
    document.getElementById('petty-batch-refresh').onclick = function () { loadBatchStatus(); };
    document.getElementById('petty-batch-confirm-exact').onclick = confirmAllExactBatchItems;
    if (batchStatusData && batchStatusKey === currentBatchKey()) renderBatchStatus(batchStatusData);
    else loadBatchStatus();
  }

  async function uploadBatchFiles(files) {
    if (batchUploadBusy) { toast('当前批量上传仍在进行，请稍候'); return; }
    if (!files.length) return;
    if (files.length > 60) { toast('一次最多选择 60 份凭证，请分两批上传'); return; }
    var invalid = files.find(function (file) { return !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024; });
    if (invalid) { toast('“' + invalid.name + '”不是 10MB 以内的 JPG、PNG 或 PDF'); return; }
    if (isLocalPreview()) { toast('本地预览不上传真实凭证'); return; }
    var batchId = crypto.randomUUID(), month = document.getElementById('month').value;
    var status = document.getElementById('petty-batch-status');
    var select = document.getElementById('petty-batch-select');
    batchUploadBusy = true;
    if (select) select.disabled = true;
    var fileResults = files.map(function (file) { return { name: file.name, status: '等待上传' }; });
    var nextFileIndex = 0;
    batchUploadSummaryText = '';
    batchUploadSummaryKey = currentBatchKey();
    function renderUploadProgress() {
      if (!status) return;
      status.textContent = '批量上传进度（最多同时 2 份）：\n' + fileResults.map(function (item) { return item.name + '：' + item.status; }).join('\n');
    }
    async function uploadNextFile() {
      var index = nextFileIndex++;
      if (index >= files.length) return;
      var file = files[index];
      fileResults[index].status = '正在上传';
      renderUploadProgress();
      try {
        await api('petty_cash_batch_upload', { store: currentStore(), month: month, batch_id: batchId,
          filename: file.name, mime_type: file.type, base64: await fileBase64(file) });
        fileResults[index].status = '已保存';
      } catch (error) {
        fileResults[index].status = '结果未确认：' + error.message + '（请刷新核验，不要直接重传）';
      }
      renderUploadProgress();
      await uploadNextFile();
    }
    try {
      await Promise.all([uploadNextFile(), uploadNextFile()]);
      var success = fileResults.filter(function (item) { return item.status === '已保存'; }).length;
      var failed = fileResults.filter(function (item) { return item.status !== '已保存'; });
      batchUploadSummaryText = '本次上传结果：' + success + ' 份已保存，' + failed.length + ' 份需核验。\n'
        + fileResults.map(function (item) { return item.name + '：' + item.status; }).join('\n')
        + (failed.length ? '\n结果未确认的文件请先刷新本月批次/凭证中心核查；确认没有保存后，再只选择未保存的文件补传。' : '');
      if (status) status.textContent = batchUploadSummaryText;
      if (success) {
        if (status) status.textContent = '已上传 ' + success + ' 份，正在启动自动识别…';
        batchLastWakeAt = Date.now();
        try { await api('voucher_ocr_wake', { store: currentStore(), limit: 5 }); } catch (_) {}
        toast('批量上传完成：成功 ' + success + ' 份' + (failed.length ? '，失败 ' + failed.length + ' 份' : '') + '。请核对识别结果。');
      }
      await loadBatchStatus(batchId);
    } finally {
      batchUploadBusy = false;
      if (select) select.disabled = false;
      if (batchStatusData && batchStatusKey === currentBatchKey()) renderBatchStatus(batchStatusData);
    }
  }

  function batchItemDraft(itemId) {
    var card = document.querySelector('[data-petty-batch-item="' + itemId + '"]');
    if (!card) return null;
    var target = card.querySelector('[data-batch-target]').value;
    var split = target.indexOf(':');
    return { card: card, target_kind: split > 0 ? target.slice(0, split) : '', target_id: split > 0 ? target.slice(split + 1) : '',
      corrected_fields: { document_date: card.querySelector('[data-batch-date]').value,
        amount: card.querySelector('[data-batch-amount]').value,
        counterparty: card.querySelector('[data-batch-counterparty]').value,
        document_number: card.querySelector('[data-batch-number]').value } };
  }

  async function confirmBatchItem(item, quiet) {
    var draft = batchItemDraft(item.id);
    if (!draft || !draft.target_id || !draft.corrected_fields.document_date || !(Number(draft.corrected_fields.amount) > 0)) {
      if (!quiet) toast('请先核对凭证日期、金额，并选择对应的备用金明细');
      return false;
    }
    var target = (batchStatusData.targets || []).find(function (row) { return row.id === draft.target_id && row.target_kind === draft.target_kind; });
    if (!target) { if (!quiet) toast('对应明细已变化，请刷新后重新选择'); return false; }
    var same = target.transaction_date === draft.corrected_fields.document_date && Math.abs(Number(target.amount) - Number(draft.corrected_fields.amount)) <= 0.01;
    if (!same && !quiet && !window.confirm('凭证日期或金额与所选明细不完全一致。已核对原图并确认仍要对应到这一笔吗？')) return false;
    var button = draft.card.querySelector('[data-petty-batch-confirm]');
    if (button) { button.disabled = true; button.textContent = '正在确认…'; }
    try {
      await api('petty_cash_batch_confirm', { store: currentStore(), month: document.getElementById('month').value,
        batch_id: item.batch_id, voucher_id: item.id, target_kind: draft.target_kind, target_id: draft.target_id,
        corrected_fields: draft.corrected_fields, field_confidences: item.field_confidences || {},
        reason: '备用金月度批量凭证人工核对：' + item.original_filename + ' → ' + target.transaction_date + ' ' + target.summary });
      delete batchDrafts[item.id];
      if (!quiet) toast('本张凭证已确认并逐笔对应；备用金金额没有改变');
      return true;
    } catch (error) {
      if (!quiet) toast('确认失败：' + error.message);
      if (button) { button.disabled = false; button.textContent = '确认本张并对应'; }
      return false;
    }
  }

  async function confirmAllExactBatchItems() {
    if (!batchStatusData || batchUploadBusy) return;
    rememberBatchDrafts();
    var items = (batchStatusData.items || []).filter(function (item) { return !item.confirmed_target_id && item.match && item.match.unique_exact; });
    if (!items.length) { toast('当前没有可批量确认的唯一匹配项'); return; }
    if (!window.confirm('将确认 ' + items.length + ' 份“日期和金额均唯一一致”的凭证。只建立凭证关系，不改金额、不自动新增账目。是否继续？')) return;
    batchUploadBusy = true;
    var button = document.getElementById('petty-batch-confirm-exact');
    if (button) { button.disabled = true; button.textContent = '正在逐张确认…'; }
    var success = 0;
    try {
      for (var index = 0; index < items.length; index += 1) if (await confirmBatchItem(items[index], true)) success++;
      toast('明确匹配已确认 ' + success + ' / ' + items.length + ' 份');
      await loadPettyCashReport();
      await loadBatchStatus();
    } finally {
      batchUploadBusy = false;
      if (button) button.textContent = '确认全部明确匹配';
    }
  }

  function bindBatchItemActions() {
    document.querySelectorAll('[data-petty-batch-open]').forEach(function (button) {
      button.onclick = function () { openPrivate('voucher_url', { voucher_id: button.dataset.pettyBatchOpen }); };
    });
    document.querySelectorAll('[data-petty-batch-confirm]').forEach(function (button) {
      button.onclick = async function () {
        var item = (batchStatusData.items || []).find(function (row) { return row.id === button.dataset.pettyBatchConfirm; });
        if (!item) return;
        if (await confirmBatchItem(item, false)) {
          await loadPettyCashReport();
          await loadBatchStatus();
        }
      };
    });
    document.querySelectorAll('[data-petty-batch-item] input,[data-petty-batch-item] select').forEach(function (field) {
      field.onchange = rememberBatchDrafts;
      field.oninput = rememberBatchDrafts;
    });
  }

  function bindUploadButtons() {
    document.querySelectorAll('[data-history-petty-open]').forEach(function (button) {
      button.onclick = function () { openHistoryPetty(button.dataset.historyPettyOpen); };
    });
    document.querySelectorAll('[data-petty-exact-upload]').forEach(function (button) {
      button.onclick = function () { beginUpload(button.dataset.pettyExactUpload, button.dataset.recordId); };
    });
  }

  renderPettyCashReport = function () {
    originalRender();
    styleOnce();
    var data = state.pettyCash.data || {};
    hideLegacyPettyActions();
    insertBatchPanel(data);
    enhanceFormalEvidence(data);
    renderHistoryEvidence(data);
    bindUploadButtons();
  };
  window.ZysyrPettyCashEvidenceReady = true;
})();
