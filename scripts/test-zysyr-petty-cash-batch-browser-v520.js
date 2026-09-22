#!/usr/bin/env node
// Synthetic browser regression only. No production credentials or writes.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'operations-petty-cash-evidence.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
for (const marker of ['本月消费凭证批量上传', '确认全部明确匹配', 'petty_cash_batch_upload', 'petty_cash_batch_status', 'petty_cash_batch_confirm']) {
  assert.ok(moduleSource.includes(marker) || apiSource.includes(marker), 'missing batch marker: ' + marker);
}
assert.match(moduleSource, /hideLegacyPettyActions[\s\S]*?finance-open-upload[\s\S]*?finance-ledger-refresh/);
assert.match(apiSource, /candidate_only_before_confirmation: true[\s\S]*?amount_changed: false/);

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
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/operations.html?preview=1&role=finance');
  await page.waitForFunction(() => state.user && state.user.role === 'finance');
  await page.evaluate(async () => {
    const formal = { id: '11111111-1111-4111-8111-111111111111', transaction_date: '2026-01-02', direction: 'outflow', category: '食品', summary: '柠檬', amount: 21.8, status: 'confirmed' };
    const history = { id: '22222222-2222-4222-8222-222222222222', import_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transaction_date: '2026-01-06', direction: 'outflow', category: '装饰', summary: '鲜花', amount: 20.5, source_locator: '01!A10:H10', version: 1, historical: true };
    window.fixture = { records: [formal], history_records: [history], voucher_links: [], pending_voucher_requests: [], vouchers: [], users: [], daily_reports: [], daily_lines: [], source_cells: [], source_reports: [], history_evidence: [], history_evidence_links: [], opening_balance: 0,
      permissions: { read: true, upload_voucher: true, upload_history_evidence: true, batch_voucher: true } };
    window.batchItems = [];
    window.calls = [];
    window.confirm = () => true;
    isLocalPreview = () => false;
    api = async function (operation, payload) {
      window.calls.push({ operation, ...payload });
      if (operation === 'petty_cash_report') return window.fixture;
      if (operation === 'petty_cash_batch_upload') {
        const index = window.batchItems.length;
        window.batchItems.push({ id: index ? '44444444-4444-4444-8444-444444444444' : '33333333-3333-4333-8333-333333333333',
          batch_id: payload.batch_id, original_filename: payload.filename, mime_type: payload.mime_type, uploaded_at: '2026-09-22T03:00:00Z',
          task_status: 'queued', candidate_fields: {}, corrected_fields: {}, field_confidences: {}, match: { state: 'missing_fields', unique_exact: false, reason: '等待识别' } });
        return { saved: { id: window.batchItems[index].id } };
      }
      if (operation === 'voucher_ocr_wake') {
        window.batchItems.forEach((item, index) => {
          const target = index ? history : formal;
          item.task_status = 'succeeded';
          item.candidate_fields = { document_date: target.transaction_date, amount: target.amount, counterparty: target.summary };
          item.match = { state: 'exact', unique_exact: true, target_kind: index ? 'history' : 'formal', target_id: target.id, reason: '凭证日期和金额与一笔备用金明细一致' };
        });
        return { processed: window.batchItems.length };
      }
      if (operation === 'petty_cash_batch_status') {
        const confirmed = window.batchItems.filter(item => item.confirmed_target_id).length;
        return { month: '2026-01', items: window.batchItems, targets: [
          { ...formal, target_kind: 'formal', historical: false }, { ...history, target_kind: 'history' }
        ], summary: { total: window.batchItems.length, recognizing: window.batchItems.filter(item => item.task_status === 'queued').length,
          ready: window.batchItems.filter(item => !item.confirmed_target_id && item.match.unique_exact).length, needs_review: 0, confirmed } };
      }
      if (operation === 'petty_cash_batch_confirm') {
        const item = window.batchItems.find(row => row.id === payload.voucher_id);
        item.confirmed_target_kind = payload.target_kind; item.confirmed_target_id = payload.target_id;
        item.match = { state: 'confirmed', unique_exact: false, target_kind: payload.target_kind, target_id: payload.target_id, reason: '财务已确认并建立逐笔凭证关系' };
        return { saved: true, amount_changed: false };
      }
      if (operation === 'voucher_url') return { url: 'data:image/png;base64,iVBORw0KGgo=', filename: '凭证.png' };
      throw Error('Unexpected API call: ' + operation);
    };
    state.finance.data = { categories: [], approved_vouchers: [] };
    loadFinanceWorkbench = async function () {};
    loadPettyCashReport = async function () { state.pettyCash.data = window.fixture; renderPettyCashReport(); };
    document.getElementById('month').value = '2026-01';
    await showView('finance-workbench');
  });

  await page.locator('#petty-batch-panel').waitFor();
  assert.equal(await page.locator('#finance-open-upload').count(), 0, 'legacy upload center button must be hidden on petty page');
  assert.equal(await page.locator('#finance-ledger-refresh').count(), 0, 'legacy refresh button must be hidden on petty page');
  assert.match(await page.locator('#petty-batch-panel').innerText(), /月底一次上传[\s\S]*不改金额、不自动入账/);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#petty-batch-select').click();
  await (await chooser).setFiles([
    { name: '柠檬.png', mimeType: 'image/png', buffer: Buffer.from('receipt-a') },
    { name: '鲜花.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('receipt-b') },
  ]);
  await page.waitForFunction(() => window.calls.filter(call => call.operation === 'petty_cash_batch_upload').length === 2);
  await page.waitForFunction(() => document.querySelectorAll('[data-petty-batch-item]').length === 2);
  assert.equal(await page.locator('#petty-batch-confirm-exact').isEnabled(), true);
  assert.match(await page.locator('#petty-batch-summary').innerText(), /已上传 2[\s\S]*明确匹配 2/);
  await page.locator('#petty-batch-confirm-exact').click();
  await page.waitForFunction(() => window.calls.filter(call => call.operation === 'petty_cash_batch_confirm').length === 2);
  await page.waitForFunction(() => document.querySelectorAll('.petty-batch-item.confirmed').length === 2);
  const confirms = await page.evaluate(() => window.calls.filter(call => call.operation === 'petty_cash_batch_confirm'));
  assert.deepEqual(confirms.map(call => call.target_kind).sort(), ['formal', 'history']);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.operation === 'petty_cash_record')), false, 'batch receipts must never create or change a petty-cash amount');
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'batch UI must not create page overflow');
  assert.deepEqual(errors, []);
  console.log('v520 browser: hidden legacy controls, multi-upload feedback, OCR suggestions and human batch confirmation passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
});
