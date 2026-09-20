/* Synthetic browser regression: no production sessions or financial writes. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});
let browser;
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1280, 390]) {
    for (const storeName of ['向里造型', '自由手艺人']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(origin + '/operations.html?preview=1&role=finance');
      await page.evaluate(async store => {
        await showView('daily-report');
        currentStore = () => store;
        state.user.role = 'finance';
        const source = previewDailySheetData();
        source.cells = source.cells.filter(cell => ['stylist', 'summary', 'payment'].includes(cell.section_code));
        source.cells.forEach(cell => {
          cell.ocr_numeric = null;
          cell.corrected_numeric = null;
          cell.manual_override = false;
          cell.source_method = 'blank_template';
        });
        function set(section, row, column, value, manual) {
          const cell = source.cells.find(item => item.section_code === section && item.row_key === row && item.column_code === column);
          if (!cell) throw new Error('Fixture missing ' + section + '/' + row + '/' + column);
          cell.ocr_numeric = value;
          cell.manual_override = !!manual;
          cell.corrected_numeric = manual ? value : null;
          cell.source_method = 'codex_local_candidate';
        }
        set('stylist', 'stylist_1', 'wash_cut_blow', 2126);
        set('stylist', 'stylist_1', 'subtotal', 2126);
        set('stylist', 'stylist_category_total', 'wash_cut_blow', 2126);
        set('summary', 'summary', 'stylist_total', 2126, true);
        set('summary', 'summary', 'actual_total', 226);
        set('summary', 'summary', 'treatment_card', 2126, true);
        set('summary', 'summary', 'grand_total', 226);
        set('payment', 'payment', 'alipay', 1850);
        set('payment', 'payment', 'wechat', 50);
        set('payment', 'payment', 'group_buy', 226);
        set('payment', 'payment', 'cash_flow', 226);
        set('payment', 'payment', 'total', 2126);
        source.cells.filter(cell => cell.row_key === 'stylist_1').forEach(cell => { cell.row_label_source_method = 'codex_local_candidate'; });
        source.draft = { id: 'fixture-draft', report_date: '2026-01-01', status: 'draft', edit_revision: 4, source_voucher_id: 'fixture-voucher', validation_result: { valid: false } };
        source.permissions = { write: true };
        source.attachments = [];
        source.history = [];
        window.fixtureSource = source;
        state.imports.sheet = structuredClone(source);
        state.imports.dirty = {};
        state.imports.dirtyLabels = {};
        isLocalPreview = () => false;
        window.savedDailyPayloads = [];
        window.confirmDailyPayloads = [];
        window.dailyOperations = [];
        api = async (operation, payload) => {
          if (operation === 'daily_recognition_job_read') return { job: null };
          window.dailyOperations.push(operation);
          if (payload.store !== store) throw new Error('Wrong store');
          if (operation === 'daily_sheet_month') return { month: '2026-01', days: [] };
          if (payload.draft_id !== 'fixture-draft') throw new Error('Wrong draft');
          if (window.fixtureDelay) await new Promise(resolve => setTimeout(resolve, window.fixtureDelay));
          if (operation === 'daily_sheet_read') {
            if (window.fixtureReadFailure) throw new Error('read unavailable');
            return structuredClone(source);
          }
          if (operation === 'daily_sheet_confirm') {
            window.confirmDailyPayloads.push(payload);
            if (!payload.reviewed_all || !source.draft.validation_result.valid) throw new Error('Unreviewed draft');
            if (window.fixturePostFailure) throw new Error('confirm unavailable');
            source.draft.status = 'confirmed';
            if (window.fixtureLostReply) throw new Error('reply lost');
            return { confirmed: true };
          }
          if (operation !== 'daily_sheet_save') throw new Error('Unexpected operation: ' + operation);
          if (window.fixtureSaveFailure) throw new Error('save unavailable');
          window.savedDailyPayloads.push(payload);
          payload.cells.forEach(edit => {
            const cell = source.cells.find(item => item.id === edit.id);
            if (cell && !Object.hasOwn(edit, 'value') && edit.row_label) {
              source.cells.filter(item => item.row_key === cell.row_key && item.section_code === cell.section_code).forEach(item => {
                item.row_label = edit.row_label;
                item.row_label_source_method = 'manual_entry';
              });
              return;
            }
            if (!cell || !Object.hasOwn(edit, 'value')) return;
            cell.corrected_numeric = edit.value == null ? null : Number(edit.value);
            cell.manual_override = true;
          });
          source.draft.edit_revision++;
          source.draft.validation_result = { valid: !window.fixtureValidationFailure && source.cells.filter(cell => cell.ocr_numeric != null).every(cell => cell.manual_override) };
          if (window.fixtureChangedAfterSave) source.cells.find(cell => cell.section_code === 'summary' && cell.column_code === 'treatment_card').corrected_numeric = 10;
          return structuredClone(source);
        };
        state.dailyReportMonth = null;
        renderDailySheetDetail();
      }, storeName);
      const alignment = await page.evaluate(() => {
        const table = document.querySelector('#daily-detail-grid table');
        return ['summary', 'payment'].flatMap(section => {
          return Array.from(table.querySelectorAll('input[data-section="' + section + '"]')).filter(input => ['summary', 'payment'].includes(input.dataset.rowKey) && input.dataset.columnNumber >= 1).flatMap(input => {
            const header = Array.from(table.querySelectorAll('th[data-paper-column]')).find(th => th.dataset.paperColumn === input.dataset.columnCode && (section === 'summary' ? th.parentElement.querySelector('[data-paper-column="actual_total"]') : th.parentElement.querySelector('[data-paper-column="cash_flow"]')));
            if (!header) return [];
            const head = header.getBoundingClientRect(), cell = input.parentElement.getBoundingClientRect();
            return [{ section, code: input.dataset.columnCode, width: head.width, dx: Math.abs(head.left - cell.left), dw: Math.abs(head.width - cell.width) }];
          });
        });
      });
      assert.equal(alignment.length, 26);
      alignment.forEach(item => assert.ok(item.width > 0 && item.dx < 1 && item.dw < 1, JSON.stringify({ storeName, width, ...item })));
      const actual = page.locator('#daily-detail-grid [data-section="summary"][data-column-code="actual_total"]');
      const grand = page.locator('#daily-detail-grid [data-section="summary"][data-column-code="grand_total"]');
      const cashflow = page.locator('#daily-detail-grid [data-section="payment"][data-column-code="cash_flow"]');
      assert.equal(await actual.inputValue(), '226');
      assert.match(await actual.getAttribute('class'), /control-mismatch/);
      assert.match(await page.locator('#daily-detail-confirm-help').textContent(), /实做为 226.00 元/);
      await actual.fill('2126');
      await grand.fill('2126');
      await cashflow.fill('2126');
      await page.locator('#daily-detail-grid [data-section="summary"][data-column-code="treatment_card"]').fill('');
      await page.locator('#daily-detail-save').click();
      assert.match(await page.locator('#daily-detail-note').textContent(), /保存成功/);
      assert.equal(await actual.inputValue(), '2126');
      assert.equal(await page.evaluate(() => window.confirmDailyPayloads.length), 0, 'save draft must never post');
      assert.equal(await page.locator('#daily-detail-adopt').count(), 0, 'separate adoption action removed');
      assert.equal(await page.locator('#daily-detail-reviewed').count(), 0, 'no repeated review checkbox');
      assert.equal(await page.locator('#daily-detail-confirm-top').textContent(), '入账');
      if (width === 1280 && storeName === '向里造型') {
        await page.locator('#daily-report-detail .finance-record-head').first().screenshot({ path: '/private/tmp/zysyr-daily-v509-toolbar.png' });
        await page.locator('#daily-report-detail .daily-confirm-bar').screenshot({ path: '/private/tmp/zysyr-daily-v509-actions.png' });
      }
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#daily-detail-confirm-top').click();
      await page.waitForFunction(() => document.getElementById('daily-detail-confirm').textContent === '已入账');
      assert.equal(await page.locator('#daily-detail-controls .bad').count(), 0);
      assert.equal(await page.locator('#daily-detail-confirm').getAttribute('data-block-reason'), '');
      assert.equal(await page.locator('#daily-detail-confirm-top').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.confirmDailyPayloads.length), 1);
      assert.match(await page.locator('#daily-detail-note').textContent(), /入账成功/);
      const saved = await page.evaluate(() => window.savedDailyPayloads[0].cells.map(cell => [cell.section_code, cell.column_code, cell.value]));
      assert.deepEqual(saved, [['summary', 'actual_total', '2126'], ['summary', 'grand_total', '2126'], ['payment', 'cash_flow', '2126'], ['summary', 'treatment_card', null]]);
      const adopted = await page.evaluate(() => window.savedDailyPayloads[1].cells);
      assert.ok(adopted.some(cell => cell.row_label && !Object.hasOwn(cell, 'value')), 'reviewed names saved with numeric candidates');
      assert.ok(!adopted.some(cell => cell.column_code === 'stylist_total'), 'unchanged manual amount must not be overwritten');
      if (width === 1280 && storeName === '向里造型') {
        async function reset(flags = {}) {
          await page.evaluate(flags => {
            for (const key of ['fixtureDelay', 'fixtureReadFailure', 'fixturePostFailure', 'fixtureLostReply', 'fixtureSaveFailure', 'fixtureValidationFailure', 'fixtureChangedAfterSave']) window[key] = false;
            Object.assign(window, flags);
            const source = window.fixtureSource;
            source.draft.status = 'draft';
            source.draft.validation_result = { valid: false };
            source.locked = false;
            source.permissions.write = true;
            const cell = source.cells.find(cell => cell.section_code === 'payment' && cell.column_code === 'alipay');
            cell.manual_override = false;
            cell.corrected_numeric = null;
            source.cells.find(cell => cell.section_code === 'summary' && cell.column_code === 'treatment_card').corrected_numeric = null;
            state.imports.sheet = structuredClone(source);
            state.imports.dirty = {};
            state.imports.dirtyLabels = {};
            state.user.role = 'finance';
            window.savedDailyPayloads = [];
            window.confirmDailyPayloads = [];
            window.dailyOperations = [];
            renderDailySheetDetail();
          }, flags);
        }
        async function post() {
          page.once('dialog', dialog => dialog.accept());
          await page.evaluate(() => confirmDailyReportDetail());
        }
        await reset();
        page.once('dialog', dialog => dialog.dismiss());
        await page.evaluate(() => confirmDailyReportDetail());
        assert.deepEqual(await page.evaluate(() => dailyOperations), [], 'cancel must neither save nor post');
        await actual.fill('226');
        await page.locator('#daily-detail-confirm').click();
        assert.deepEqual(await page.evaluate(() => dailyOperations), [], 'unequal totals must not write');
        await reset({ fixtureSaveFailure: true });
        await post();
        assert.equal(await page.evaluate(() => confirmDailyPayloads.length), 0, 'save failure must stop posting');
        assert.ok(await page.evaluate(() => dailySheetDirtyCount() > 0), 'failed save must retain reviewed edits');
        await reset({ fixtureValidationFailure: true });
        await post();
        assert.equal(await page.evaluate(() => confirmDailyPayloads.length), 0, 'backend validation must remain authoritative');
        assert.match(await page.locator('#daily-detail-note').textContent(), /后台校验/);
        await reset({ fixtureChangedAfterSave: true });
        await post();
        assert.equal(await page.evaluate(() => confirmDailyPayloads.length), 0, 'changed readback requires another review');
        assert.match(await page.locator('#daily-detail-note').textContent(), /回读内容/);
        await reset({ fixtureDelay: 150 });
        page.once('dialog', dialog => dialog.accept());
        await page.evaluate(() => { window.pendingPost = confirmDailyReportDetail(); confirmDailyReportDetail(); });
        assert.equal(await page.locator('#store-select').isDisabled(), true, 'store switch locked during posting');
        await page.evaluate(() => window.pendingPost);
        assert.equal(await page.evaluate(() => confirmDailyPayloads.length), 1, 'rapid repeat clicks post once');
        await reset({ fixtureLostReply: true, fixtureReadFailure: true });
        await post();
        assert.match(await page.locator('#daily-detail-note').textContent(), /先查询结果/);
        assert.equal(await actual.evaluate(input => input.readOnly), true, 'uncertain posting freezes edits until result recovery');
        assert.equal(await page.locator('#daily-detail-save').isDisabled(), true);
        await page.evaluate(() => { fixtureReadFailure = false; fixtureLostReply = false; });
        await page.evaluate(() => confirmDailyReportDetail());
        assert.equal(await page.evaluate(() => confirmDailyPayloads.length), 1, 'uncertain result must be queried, not resubmitted');
        assert.equal(await page.locator('#daily-detail-confirm').textContent(), '已入账');
        await reset();
        await page.evaluate(() => { state.imports.sheet.locked = true; renderDailyDetailControls(); });
        await page.evaluate(() => confirmDailyReportDetail());
        assert.deepEqual(await page.evaluate(() => dailyOperations), [], 'locked report must not save or post');
        await reset();
        await page.evaluate(() => { state.user.role = 'shareholder'; renderDailyDetailControls(); });
        assert.equal(await page.locator('#daily-detail-confirm').isDisabled(), true);
        await page.evaluate(() => confirmDailyReportDetail());
        assert.deepEqual(await page.evaluate(() => dailyOperations), [], 'non-finance account must not post');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log('Daily report: aligned headers, save-only, reviewed posting, candidates, failure gates and uncertain-result recovery passed in both stores at desktop/mobile widths.');
}
run().finally(async () => { if (browser) await browser.close(); server.close(); }).catch(error => { console.error(error); process.exitCode = 1; });
