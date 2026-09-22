/* Per-item petty-cash evidence. Whole-month bundles remain audit sources only. */
(function () {
  'use strict';
  if (typeof renderPettyCashReport !== 'function') return;

  var originalRender = renderPettyCashReport;
  var uploadGeneration = 0;
  var uploadBusy = false;

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
      '@media(max-width:760px){.petty-evidence-list{grid-template-columns:1fr}.petty-evidence-item{padding:11px}.petty-evidence-actions button{flex:1 1 140px}.petty-evidence-item-head{gap:8px}}'
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

  async function loadHistoryFile(file, host) {
    function retry() { host.innerHTML = '<div class="help">正在重新读取本笔凭证…</div>'; loadHistoryFile(file, host); }
    try {
      var result = await api('history_evidence_images', { store: currentStore(), evidence_id: file.id });
      monthlyVoucherView.fileView(Object.assign({}, file, result), host, retry);
    } catch (error) {
      monthlyVoucherView.fileView(Object.assign({}, file, { preview_error: error.message }), host, retry);
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
    enhanceFormalEvidence(data);
    renderHistoryEvidence(data);
    bindUploadButtons();
  };
})();
