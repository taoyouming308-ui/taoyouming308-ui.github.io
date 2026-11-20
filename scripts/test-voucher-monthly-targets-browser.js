/* Synthetic browser regression only: no real accounts, originals or service URLs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const screenshotDir = path.join(root, 'artifacts', 'monthly-targets-acceptance');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const copy = value => JSON.parse(JSON.stringify(value));
const month = '2026-07';
const store = '合成门店';
const originalId = id(100);
const reportId = id(200);
const cellId = id(201);
const targetId = reportId + '~' + cellId;
const targetValue = 'monthly_cell:' + targetId;
const modules = ['operations-expense-voucher-workspace.js', 'operations-petty-cash-evidence.js'];
const source = modules.map(file => ({ file, content: fs.readFileSync(path.join(root, file), 'utf8') }));

function fixture(options = {}) {
  const target = {
    id: targetId, target_kind: 'monthly_cell', report_id: reportId, cell_id: cellId,
    source_locator: 'C12', summary: '房租 / 七月', category: 'expense', amount: 2000,
    period_month: month, aggregate: true, manual_only: true, can_attach: true,
    disabled: false, disabled_reason: '', linked_vouchers: [],
  };
  const targetFor = (number, summary, amount, extra = {}) => ({
    ...target, id: reportId + '~' + id(number), cell_id: id(number),
    source_locator: 'C' + number, summary, amount, ...extra,
  });
  const item = {
    id: id(10), source_voucher_id: originalId, component_index: 0,
    component_count: options.split ? 2 : 1, original_filename: '合成多笔原图.png',
    mime_type: 'image/png', batch_id: id(300), uploaded_at: '2026-11-20T01:00:00Z',
    latest_ocr_task: { id: id(301) }, task_status: 'succeeded', audit_status: 'pending',
    candidate_fields: { document_kind: 'multiple_transactions', document_type: 'chat_transfers' },
    field_confidences: {}, monthly_cell_evidence: [],
    match: { state: 'needs_review', reason: '日期及金额待逐笔核对', candidates: [] },
  };
  if (options.auto) {
    item.automate_on_read = true;
    item.match = { ...item.match, state: 'exact', target_kind: 'monthly_cell', target_id: targetId,
      auto_eligible: true, unique_exact: true };
  }
  const items = [item];
  if (options.split) items.push({ ...copy(item), id: id(11), component_index: 1,
    candidate_fields: { document_kind: 'receipt', document_type: 'chat_transfers' },
    latest_ocr_task: { id: id(302) } });
  if (options.existingTransactions) {
    items.push({ ...copy(item), id: id(20), source_voucher_id: id(120), component_count: 1,
      confirmed_target_kind: 'formal', confirmed_target_id: id(403),
      corrected_fields: { document_date: month + '-06', amount: 15, counterparty: '原逐笔收款方' } });
    items.push({ ...copy(item), id: id(21), source_voucher_id: id(121), component_count: 1,
      confirmed_target_kind: 'monthly_source', confirmed_target_id: id(400) + '~C17',
      expense_association: { id: id(500), mode: 'auto' },
      corrected_fields: { document_date: month + '-07', amount: 300, counterparty: '原人工核对保留' } });
  }
  const data = {
    month, items, summary: { total: 1, recognizing: 0, ready: options.auto ? 1 : 0,
      needs_review: 1, confirmed: 0, auto_matched: 0, failed: 0 },
    targets: [target,
      targetFor(202, '产品进货 / 合成品牌 / 合计', 700),
      targetFor(203, '备用金 / 食品 / 合计', 30),
      targetFor(204, '杂项 / 原件金额空白', null,
        { can_attach: false, disabled: true, disabled_reason: '月报金额空白，请先核对' }),
      targetFor(205, '人工 / 技术人员', 8000, { category: 'salary' }),
      targetFor(206, '备用金', 900, { category: 'petty_cash_summary' }),
      targetFor(207, '产品成本 / 产品进货', 1200, { category: 'purchase_summary' }),
      { id: id(400) + '~C17', target_kind: 'monthly_source', summary: '原件水费', category: '水费',
        amount: 300, period_month: month, aggregate: true, source_locator: 'C17' },
      { id: id(401), target_kind: 'source_petty', summary: '原件逐笔食品', amount: 12,
        period_month: month, transaction_date: month + '-04', aggregate: false },
      { id: id(402), target_kind: 'draft', summary: '导入待核对纸巾', amount: 20,
        period_month: month, transaction_date: month + '-05', aggregate: false },
      { id: id(403), target_kind: 'formal', summary: '电子备用金清洁', amount: 15,
        period_month: month, transaction_date: month + '-06', aggregate: false },
      { id: id(404), target_kind: 'history', summary: '历史备用金办公', amount: 18,
        period_month: month, transaction_date: month + '-07', aggregate: false }],
    source_status: 'missing', source_message: '尚未指定月报核对原件；原件匹配暂不可用',
    monthly_targets_status: 'ready', monthly_targets_message: '当前电子月报仅供人工补充佐证，不自动匹配',
    expense_links: [], candidate_only: true, formal_ledger_written: false,
  };
  if (options.missingCatalog) {
    data.targets = data.targets.filter(target => target.target_kind !== 'monthly_cell');
    data.monthly_targets_status = 'missing';
    data.monthly_targets_message = '当前电子月报尚未载入，请先核对本月月报；逐笔明细仍保留';
  }
  if (options.existingTransactions) { data.summary.total = 3; data.summary.confirmed = 2; }
  if (options.seededEvidence) {
    data.targets[0].linked_vouchers = [originalId];
    for (const entry of data.items) if ((entry.source_voucher_id || entry.id) === originalId) entry.monthly_cell_evidence = [{
      target_id: targetId, report_id: reportId, cell_id: cellId, summary: target.summary, source_locator: target.source_locator,
    }];
  }
  return data;
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "connect-src 'none'; img-src data:; frame-src 'none'" });
  response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>*{box-sizing:border-box}body{margin:0;padding:12px;font:14px sans-serif}input,select{max-width:100%}.hidden{display:none}</style>'
    + '<select id="month"><option>2026-07</option><option>2026-08</option></select>'
    + '<div id="finance-workbench-status"></div><div id="petty-cash-report-table"></div></html>');
});

async function harness(browser, baseURL, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  const page = await context.newPage();
  const calls = [], errors = [], external = [], navigations = [];
  const data = fixture(options);
  let attached = false, releaseList = null, releasePreWorkspace = null, workspaceReads = 0, workspaceFailure = Boolean(options.workspaceRefreshFails);
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === baseURL) return route.continue();
    external.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.exposeFunction('backend', async (operation, payload = {}) => {
    calls.push({ operation, payload: copy(payload) });
    if (operation === 'expense_voucher_workspace') {
      workspaceReads++;
      if (attached && workspaceFailure) throw Error('合成月报佐证状态刷新失败，请稍后重试');
      const result = copy(data);
      if (options.holdPreAttachWorkspace && workspaceReads === 2 && !attached) await new Promise(resolve => { releasePreWorkspace = resolve; });
      result.month = payload.month;
      if (payload.month !== month) {
        result.items = [];
        result.targets = [];
        result.summary = { total: 0, recognizing: 0, ready: 0, needs_review: 0, confirmed: 0 };
      }
      return result;
    }
    if (operation === 'monthly_voucher_library') {
      assert.equal(payload.store, store);
      assert.equal(payload.month, month);
      assert.equal(payload.report_id, reportId);
      const target = data.targets.find(row => row.target_kind === 'monthly_cell' && row.report_id === payload.report_id && row.cell_id === payload.cell_id);
      assert.ok(target, 'the evidence-only route retains the exact selected report/cell');
      assert.equal(payload.context, 'expense_workspace');
      if (payload.action === 'attach') {
        assert.equal(payload.voucher_id, originalId, 'split component must use its original voucher id');
        assert.equal(payload.confirmed, true);
        assert.ok(payload.reason.includes(target.summary));
        for (const forbidden of ['amount', 'document_date', 'corrected_fields', 'target_snapshot', 'items']) {
          assert.equal(Object.hasOwn(payload, forbidden), false, 'evidence-only attach must not send ' + forbidden);
        }
        if (options.toxicAck) return copy(options.toxicAck);
        attached = true;
        const evidence = { target_id: target.id, report_id: target.report_id, cell_id: target.cell_id,
          summary: target.summary, source_locator: target.source_locator };
        target.linked_vouchers = [...new Set([...(target.linked_vouchers || []), originalId])];
        for (const item of data.items) if ((item.source_voucher_id || item.id) === originalId) {
          item.monthly_cell_evidence = [...(item.monthly_cell_evidence || []).filter(link => link.target_id !== evidence.target_id), copy(evidence)];
        }
        return { cell_linked: true, already_linked: false, amount_changed: false, posted: false };
      }
      if (payload.action === 'list') {
        if (options.holdList) await new Promise(resolve => { releaseList = resolve; });
        if (options.listFails) throw Error('合成回读暂不可用');
        return { items: [{ id: originalId, source_voucher_id: originalId,
          original_filename: '合成多笔原图.png', already_linked: options.unlinkedRead ? false : target.linked_vouchers.includes(originalId) }], truncated: false };
      }
      throw Error('Unexpected monthly library action: ' + payload.action);
    }
    if (operation === 'report_source_review') return { month: payload.month, expense_voucher_targets: [], expense_voucher_matches: [] };
    throw Error('Forbidden synthetic writer/operation: ' + operation);
  });
  await page.goto(baseURL);
  async function mount() {
  await page.evaluate(({ store, reportId, holdPettyReport }) => {
    window.syntheticStore = store;
    window.currentStore = () => window.syntheticStore;
    window.state = { session: 'synthetic-session-not-real', view: 'voucher-center',
      user: { username: 'synthetic-finance', role: 'finance', can_manage_finance_workbench: true,
        can_match_expense_vouchers: true },
      data: { monthly_report: { id: reportId } }, trace: { address: '' },
      pettyCash: { data: { records: [], history_records: [], permissions: { batch_voucher: true } } } };
    window.ZysyrPettyScopeIdentity = () => state.session + ':' + state.user.username;
    window.ZysyrTime = { dateTime: () => '' };
    window.esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    window.formatAmount = value => Number(value).toFixed(2);
    window.isLocalPreview = () => false;
    window.api = (operation, payload) => window.backend(operation, payload);
    window.syntheticToasts = [];
    window.toast = message => window.syntheticToasts.push(message);
    window.openPrivate = (operation, payload) => window.backend(operation, payload);
    window.openCellTrace = () => {};
    window.renderPettyCashReport = () => {};
    window.syntheticPettyReads = 0;
    window.loadPettyCashReport = async () => { window.syntheticPettyReads++; if (holdPettyReport) await new Promise(() => {}); };
  }, { store, reportId, holdPettyReport: Boolean(options.holdPettyReport) });
  for (const script of source) {
    await page.addScriptTag({ content: script.content });
    if (options.legacyWorkspace && script.file === 'operations-expense-voucher-workspace.js') {
      await page.evaluate(() => {
        // Self-contained v676 protocol facade, not a dependency on Git history.
        // A long-open page can keep the old workspace while its lazy module is new.
        const workspace = window.ZysyrExpenseVoucherWorkspace;
        const currentOptions = workspace.options;
        delete workspace.canAttachMonthlyCell;
        delete workspace.attachMonthlyCell;
        workspace.options = (targets, selected, suggestions) => currentOptions(
          targets.filter(target => target.target_kind !== 'monthly_cell'), selected, suggestions);
        window.syntheticLegacyAutoCalls = 0;
        window.syntheticLegacyAutoInputs = [];
        workspace.autoMatch = async (data, scope, isCurrent, isDirty, includeExisting) => {
          window.syntheticLegacyAutoCalls++;
          window.syntheticLegacyAutoInputs.push((data.items || []).map(item => ({
            kind: item.match && item.match.target_kind,
            evidenceCount: (item.monthly_cell_evidence || []).length,
            manualOnly: (data.targets || []).some(target => item.match && target.target_kind === item.match.target_kind
              && target.id === item.match.target_id && target.manual_only),
          })));
          const items = (data.items || []).filter(item => !item.confirmed_target_id && item.match && item.match.auto_eligible
            && (includeExisting || item.automate_on_read) && !isDirty(item.id)).slice(0, 20);
          if (!items.length || !isCurrent()) return 0;
          const result = await window.api('expense_voucher_match_apply', { ...scope, mode: 'auto',
            items: items.map(item => ({ voucher_id: item.source_voucher_id || item.id,
              component_index: item.component_index || 0, task_id: item.latest_ocr_task && item.latest_ocr_task.id,
              target_kind: item.match.target_kind, target_id: item.match.target_id })) });
          return Number(result.saved && result.saved.inserted || 0);
        };
      });
    }
  }
  await page.evaluate(() => renderPettyCashReport());
  await page.locator('[data-petty-batch-item]').first().waitFor();
  }
  await mount();
  return {
    page, data, calls, errors, external, navigations,
    card: () => page.locator('[data-petty-batch-item="' + id(10) + '"]'),
    reload: async () => { await page.reload(); await mount(); },
    recoverWorkspace: () => { workspaceFailure = false; },
    releasePreWorkspace: () => { assert.equal(typeof releasePreWorkspace, 'function'); releasePreWorkspace(); },
    release: () => { assert.equal(typeof releaseList, 'function', 'the controlled readback must have started'); releaseList(); },
    close: async () => {
      assert.deepEqual(errors, [], 'no browser exception');
      assert.deepEqual(external, [], 'no external service request');
      const forbidden = calls.filter(call => /expense_voucher_(?:match|combination)|petty_cash_batch_confirm|monthly_cell_save|voucher_review|expense_payment|expense_save/.test(call.operation));
      assert.deepEqual(forbidden, [], 'monthly evidence must never use a financial or expense-match writer');
      await context.close();
    },
  };
}

async function chooseMonthly(h) {
  await h.card().locator('[data-batch-target]').selectOption(targetValue);
  const button = h.card().locator('[data-petty-batch-confirm]');
  await button.waitFor({ state: 'visible' });
  assert.equal(await button.isDisabled(), false, 'multi-transaction original can receive monthly evidence');
  assert.match(await button.innerText(), /补充月报佐证/);
  return button;
}

async function waitForToast(h, pattern) {
  await h.page.waitForFunction(source => window.syntheticToasts.some(text => new RegExp(source).test(text)), pattern.source);
}

async function cardColours(card) {
  return card.evaluate(node => { const style = getComputedStyle(node); return { background: style.backgroundColor, border: style.borderTopColor }; });
}

async function assertMonthlyGreen(h, card = h.card()) {
  assert.equal(await card.evaluate(node => node.classList.contains('monthly-evidenced')), true, 'authoritative monthly evidence gives the whole card its own completed visual state');
  assert.match(await card.locator('.petty-batch-chip').innerText(), /^已关联月报$/);
  assert.doesNotMatch(await card.innerText(), /已入账/);
  const colours = await cardColours(card);
  for (const [part, value] of Object.entries(colours)) {
    const channels = (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    assert.equal(channels.length, 3);
    assert.ok(channels[1] > channels[0] && channels[1] > channels[2], part + ' is visibly green, not just a CSS class');
  }
  const button = card.locator('[data-petty-batch-confirm]');
  assert.equal(await button.isDisabled(), true, 'the already-linked exact monthly target cannot be submitted twice');
  assert.match(await button.innerText(), /已关联月报/);
  assert.doesNotMatch(await button.innerText(), /正在|回读|处理中/);
}

async function assertNotMonthlyGreen(card) {
  assert.equal(await card.evaluate(node => node.classList.contains('monthly-evidenced')), false, 'an unverified response cannot paint monthly success');
  assert.notEqual((await cardColours(card)).background, 'rgb(244, 251, 247)');
  assert.doesNotMatch(await card.locator('.petty-batch-chip').innerText(), /已关联月报/);
}

async function runWidth(browser, baseURL, width) {
  {
    const h = await harness(browser, baseURL, width);
    try {
      const select = h.card().locator('[data-batch-target]');
      const groups = await select.locator('optgroup').evaluateAll(nodes => nodes.map(node => node.label));
      assert.ok(groups.includes('当前月报开支栏目/明细（人工佐证）'));
      assert.ok(groups.some(label => /月报全部开支栏目.*已指定原件/.test(label)), 'old monthly-source group stays visibly source-scoped');
      for (const label of ['原件备用金逐笔明细', '当前电子备用金明细', '已导入待核对明细（未入账）', '历史正式备用金明细']) assert.ok(groups.includes(label));
      const blank = select.locator('option[value="monthly_cell:' + reportId + '~' + id(204) + '"]');
      assert.equal(await blank.getAttribute('value'), 'monthly_cell:' + reportId + '~' + id(204));
      assert.equal(await blank.evaluate(node => node.disabled), true, 'blank effective monthly amount is not selectable');
      assert.notEqual(await blank.getAttribute('disabled'), null, 'disabled monthly option keeps its native disabled attribute');
      assert.match(await blank.innerText(), /空白|不可/);
      for (const cell of [202, 203, 205, 206, 207]) assert.equal(await select.locator('option[value="monthly_cell:' + reportId + '~' + id(cell) + '"]').evaluate(node => node.disabled), false,
        'backend-authorized salary, purchase and petty summary/detail targets stay selectable');
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { missingCatalog: true });
    try {
      await h.page.locator('[data-monthly-targets-status]').waitFor();
      assert.match(await h.page.locator('[data-monthly-targets-status]').innerText(), /尚未|不足|不可用/);
      assert.equal(await h.card().locator('[data-batch-target] option[value^="monthly_cell:"]').count(), 0);
      assert.ok(await h.card().locator('[data-batch-target] option[value^="draft:"]').count(), 'an unavailable monthly catalog must preserve imported detail choices');
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width);
    try {
      const button = await chooseMonthly(h);
      let dialogSeen = false;
      h.page.once('dialog', async dialog => {
        dialogSeen = true;
        assert.match(dialog.message(), /2026-07/);
        assert.match(dialog.message(), /房租/);
        assert.match(dialog.message(), /不.*(?:付款|入账)|佐证/);
        await dialog.dismiss();
      });
      await button.click();
      assert.equal(dialogSeen, true);
      assert.equal(h.calls.some(call => call.operation === 'monthly_voucher_library'), false, 'cancelled attestation cannot attach');
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 0);
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { split: true, existingTransactions: true, holdPettyReport: true });
    try {
      assert.equal(await h.card().locator('[data-batch-date]').inputValue(), '');
      assert.equal(await h.card().locator('[data-batch-amount]').inputValue(), '');
      const button = await chooseMonthly(h);
      assert.equal(await h.card().locator('[data-batch-date]').inputValue(), '', 'selecting a monthly target must not invent an OCR date');
      assert.equal(await h.card().locator('[data-batch-amount]').inputValue(), '', 'monthly target amount must not be copied into original recognition');
      assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
        'the real monthly target form must not overflow the viewport');
      await h.page.screenshot({ path: path.join(screenshotDir, 'monthly-targets-' + width + '.png'), fullPage: true });
      h.page.once('dialog', dialog => dialog.accept());
      await button.click();
      await h.page.locator('[data-monthly-cell-evidence]').first().waitFor();
      assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
        'the verified whole-image evidence badges must not overflow the viewport');
      await h.page.screenshot({ path: path.join(screenshotDir, 'evidence-' + width + '.png'), fullPage: true });
      const libraryCalls = h.calls.filter(call => call.operation === 'monthly_voucher_library');
      assert.deepEqual(libraryCalls.map(call => call.payload.action), ['attach', 'list']);
      assert.ok(h.calls.filter(call => call.operation === 'expense_voucher_workspace').length >= 2, 'verified attach is followed by authoritative workspace readback');
      for (const itemId of [id(10), id(11)]) {
        const card = h.page.locator('[data-petty-batch-item="' + itemId + '"]');
        await assertMonthlyGreen(h, card);
        assert.match(await card.locator('[data-monthly-cell-evidence]').innerText(), /月报|佐证/);
        assert.match(await card.innerText(), /逐笔对应待核对/);
        assert.equal(await card.evaluate(node => node.classList.contains('confirmed')), false, 'whole-image evidence does not confirm split components');
        assert.equal(await card.locator('[data-expense-match-change]').count(), 0, 'monthly evidence cannot use expense-match void');
      }
      assert.equal(h.data.summary.confirmed, 2, 'monthly evidence does not increase the pre-existing transaction count');
      assert.ok(h.data.items.filter(item => item.source_voucher_id === originalId).every(item => !item.confirmed_target_id && !item.expense_association));
      const transaction = h.page.locator('[data-petty-batch-item="' + id(20) + '"]');
      const association = h.page.locator('[data-petty-batch-item="' + id(21) + '"]');
      assert.equal(await transaction.evaluate(node => node.classList.contains('confirmed')), true);
      assert.equal(await transaction.evaluate(node => node.classList.contains('monthly-evidenced')), false, 'another original must not inherit the monthly colour');
      assert.match(await transaction.locator('.petty-batch-chip').innerText(), /已确认对应/);
      assert.match(await association.locator('.petty-batch-chip').innerText(), /AI 已匹配/);
      assert.equal(await association.locator('[data-expense-match-change]').count(), 1, 'old transaction correction remains in its own chain');
      assert.deepEqual(await cardColours(h.card()), await cardColours(transaction), 'monthly completion uses exactly the established green card colours');
      assert.equal(await h.page.evaluate(() => window.syntheticPettyReads), 0, 'monthly success must not wait on the unrelated petty report read');
      const beforeDuplicate = h.calls.filter(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'attach').length;
      await h.card().locator('[data-petty-batch-confirm]').evaluate(node => { node.disabled = false; node.click(); });
      await h.page.waitForTimeout(40);
      assert.equal(h.calls.filter(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'attach').length, beforeDuplicate,
        'forcing a disabled duplicate button still cannot submit the same report/cell/original tuple');
      await h.reload();
      await h.card().locator('[data-monthly-cell-evidence]').waitFor();
      await assertMonthlyGreen(h);
      assert.equal(h.calls.filter(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'attach').length, beforeDuplicate,
        'a full page reload restores success from the server without creating a new association');
      const secondValue = 'monthly_cell:' + reportId + '~' + id(202);
      await h.card().locator('[data-batch-target]').selectOption(secondValue);
      assert.equal(await h.card().locator('[data-petty-batch-confirm]').isDisabled(), false, 'another unlinked monthly target remains an explicit choice');
      assert.match(await h.card().locator('[data-petty-batch-confirm]').innerText(), /补充月报佐证/);
      h.page.once('dialog', dialog => dialog.dismiss());
      await h.card().locator('[data-petty-batch-confirm]').click();
      assert.equal(h.calls.filter(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'attach').length, beforeDuplicate);
      h.page.once('dialog', dialog => dialog.accept());
      await h.card().locator('[data-petty-batch-confirm]').click();
      await h.page.waitForFunction(() => document.querySelector('[data-petty-batch-item] [data-monthly-cell-evidence]').textContent.includes('产品进货'));
      await assertMonthlyGreen(h);
      assert.equal(h.data.items[0].monthly_cell_evidence.length, 2, 'supplementing another target preserves the old evidence tuple');
      assert.deepEqual(h.data.items.find(item => item.id === id(20)).corrected_fields,
        { document_date: month + '-06', amount: 15, counterparty: '原逐笔收款方' });
    } finally { await h.close(); }
  }
  for (const options of [
    { listFails: true }, { unlinkedRead: true },
    { toxicAck: { cell_linked: false, amount_changed: false, posted: false } },
    { toxicAck: { cell_linked: true, amount_changed: true, posted: true } },
  ]) {
    const h = await harness(browser, baseURL, width, options);
    try {
      const button = await chooseMonthly(h);
      h.page.once('dialog', dialog => dialog.accept());
      await button.click();
      await waitForToast(h, /待核验|未确认|失败/);
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 0, 'unverified ack/readback cannot show a success badge');
      await assertNotMonthlyGreen(h.card());
      assert.equal(await h.card().evaluate(node => node.classList.contains('confirmed')), false);
      const messages = await h.page.evaluate(() => window.syntheticToasts);
      assert.equal(messages.some(message => /已(?:补充|保存|确认并逐笔|关联)/.test(message)), false, 'uncertain result must not claim success');
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { auto: true });
    try {
      await h.page.evaluate(() => ZysyrPettyReloadBatch());
      await h.page.locator('#petty-batch-confirm-exact').click();
      await waitForToast(h, /已匹配\s*0\s*项/);
      assert.equal(h.calls.some(call => call.operation === 'monthly_voucher_library'), false, 'manual-only targets are never automatically attached');
      assert.equal(h.calls.some(call => call.operation === 'expense_voucher_match_apply'), false, 'manual-only targets are excluded even from hostile auto-eligible DTOs');
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { holdList: true });
    try {
      const button = await chooseMonthly(h);
      h.page.once('dialog', dialog => dialog.accept());
      await button.click();
      await h.page.waitForFunction(() => window.syntheticToasts.length >= 0);
      for (let n = 0; n < 60 && !h.calls.some(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'list'); n++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(h.calls.some(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'list'));
      await assertNotMonthlyGreen(h.card());
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 0, 'attach ACK without completed membership readback is not visual success');
      await h.page.evaluate(async () => {
        document.getElementById('month').value = '2026-08';
        document.getElementById('petty-cash-report-table').innerHTML = '';
        renderPettyCashReport();
      });
      await h.page.locator('#petty-batch-list').waitFor();
      const before = await h.page.evaluate(() => ({ html: document.getElementById('petty-batch-list').innerHTML, toasts: window.syntheticToasts.slice() }));
      h.release();
      await h.page.waitForTimeout(80);
      const after = await h.page.evaluate(() => ({ html: document.getElementById('petty-batch-list').innerHTML, toasts: window.syntheticToasts.slice() }));
      assert.deepEqual(after, before, 'late old-month evidence readback cannot alter the new-month DOM or toast');
      assert.equal(await h.page.locator('[data-monthly-cell-evidence]').count(), 0);
      assert.equal(await h.page.locator('.monthly-evidenced').count(), 0, 'old-month receipt cannot colour any new-month card');
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { workspaceRefreshFails: true, holdPettyReport: true });
    try {
      const button = await chooseMonthly(h);
      h.page.once('dialog', dialog => dialog.accept());
      await button.click();
      await h.card().locator('[data-monthly-cell-evidence]').waitFor();
      await h.page.locator('#petty-batch-status').filter({ hasText: /刷新失败|读取失败/ }).waitFor();
      await assertMonthlyGreen(h);
      assert.equal(await h.page.evaluate(() => window.syntheticPettyReads), 0);
      assert.equal(h.calls.filter(call => call.operation === 'monthly_voucher_library' && call.payload.action === 'attach').length, 1);
      h.recoverWorkspace();
      await h.reload();
      await assertMonthlyGreen(h);
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { seededEvidence: true, listFails: true });
    try {
      await assertMonthlyGreen(h);
      const secondValue = 'monthly_cell:' + reportId + '~' + id(202);
      await h.card().locator('[data-batch-target]').selectOption(secondValue);
      h.page.once('dialog', dialog => dialog.accept());
      await h.card().locator('[data-petty-batch-confirm]').click();
      await waitForToast(h, /待核验/);
      assert.equal(await h.card().evaluate(node => node.classList.contains('monthly-evidenced')), true, 'uncertain new target cannot erase already-verified old evidence');
      assert.doesNotMatch(await h.card().locator('[data-monthly-cell-evidence]').innerText(), /产品进货/);
      assert.equal(await h.card().locator('[data-petty-batch-confirm]').isDisabled(), false, 'the failed target must not pretend to be already linked');
      assert.doesNotMatch(await h.card().locator('[data-petty-batch-confirm]').innerText(), /正在|回读|已关联月报/);
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { holdPreAttachWorkspace: true });
    try {
      await h.page.evaluate(() => { window.preAttachWorkspaceRead = ZysyrPettyReloadBatch(); });
      for (let n = 0; n < 60 && h.calls.filter(call => call.operation === 'expense_voucher_workspace').length < 2; n++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(h.calls.filter(call => call.operation === 'expense_voucher_workspace').length, 2);
      const button = await chooseMonthly(h);
      h.page.once('dialog', dialog => dialog.accept());
      await button.click();
      await h.card().locator('[data-monthly-cell-evidence]').waitFor();
      await assertMonthlyGreen(h);
      h.releasePreWorkspace();
      await h.page.evaluate(() => window.preAttachWorkspaceRead);
      await assertMonthlyGreen(h);
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 1, 'a workspace response begun before attachment cannot remove the newer verified evidence');
      // A genuinely fresh authoritative read remains the source of truth;
      // success is not a permanent browser overlay hiding later server changes.
      for (const item of h.data.items) item.monthly_cell_evidence = [];
      for (const target of h.data.targets) if (target.target_kind === 'monthly_cell') target.linked_vouchers = [];
      await h.page.evaluate(() => ZysyrPettyReloadBatch());
      await assertNotMonthlyGreen(h.card());
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 0);
    } finally { await h.close(); }
  }
  {
    const h = await harness(browser, baseURL, width, { legacyWorkspace: true, auto: true });
    try {
      const warning = h.page.locator('[data-monthly-evidence-update-required]');
      await warning.waitFor();
      assert.match(await warning.innerText(), /更新/);
      const select = h.card().locator('[data-batch-target]');
      const monthlyOptions = await select.locator('option[value^="monthly_cell:"]').evaluateAll(nodes => nodes.map(node => ({ value: node.value, disabled: node.disabled })));
      assert.equal(monthlyOptions.length, h.data.targets.filter(target => target.target_kind === 'monthly_cell').length,
        'a mixed-version page keeps every monthly target visible but read-only');
      assert.ok(monthlyOptions.every(option => option.disabled), 'missing helpers disable all monthly evidence choices');
      for (const kind of ['draft', 'formal', 'history']) {
        const options = await select.locator('option[value^="' + kind + ':"]').evaluateAll(nodes => nodes.map(node => node.disabled));
        assert.ok(options.length > 0 && options.every(disabled => !disabled), 'legacy ' + kind + ' choices remain selectable');
      }
      await h.page.evaluate(() => ZysyrPettyReloadBatch());
      const legacyAuto = await h.page.evaluate(() => ({ calls: window.syntheticLegacyAutoCalls, inputs: window.syntheticLegacyAutoInputs }));
      assert.ok(legacyAuto.calls > 0, 'compatibility keeps the established legacy automatic flow available');
      assert.ok(legacyAuto.inputs.every(items => items.every(item => item.kind !== 'monthly_cell' && !item.manualOnly && item.evidenceCount === 0)),
        'every legacy auto call excludes manual-only monthly candidates and existing whole-image evidence');
      assert.equal(h.calls.some(call => call.operation === 'monthly_voucher_library'), false);
      assert.equal(h.calls.some(call => call.operation === 'expense_voucher_match_apply'), false);
      await select.evaluate((node, value) => {
        const option = [...node.options].find(option => option.value === value);
        option.disabled = false;
        node.value = value;
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, targetValue);
      await h.card().locator('[data-petty-batch-confirm]').evaluate(node => { node.disabled = false; node.click(); });
      await waitForToast(h, /更新/);
      assert.equal(h.calls.some(call => call.operation === 'monthly_voucher_library' || call.operation === 'expense_voucher_match_apply'), false,
        'forcing the DOM selection must still fail closed before either writer');
      assert.equal(await h.card().locator('[data-monthly-cell-evidence]').count(), 0);
      assert.equal(h.navigations.length, 1, 'compatibility recovery cannot force-refresh an active page');
    } finally { await h.close(); }
  }
  console.log('Monthly target browser ' + width + ': verified green whole-original status, duplicate guards, server refresh restore, independent target supplementation, preserved transaction status, uncertain/no-ACK safety, manual-only choices, stale scopes and mixed-version guards passed.');
}

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const baseURL = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [390, 1280]) await runWidth(browser, baseURL, width);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
