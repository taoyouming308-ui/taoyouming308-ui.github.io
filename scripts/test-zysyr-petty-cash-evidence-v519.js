#!/usr/bin/env node
// Synthetic browser regression only. No production credentials or writes.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'operations-petty-cash-evidence.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260922093000_zysyr_history_item_evidence_upload.sql'), 'utf8');

for (const marker of ['逐笔消费凭证', '整月 Word 凭证包继续永久留底', 'data-petty-exact-upload', 'history_evidence_images']) {
  assert.ok(moduleSource.includes(marker), 'missing per-item petty evidence marker: ' + marker);
}
assert.ok(pageSource.includes("script.src='operations-petty-cash-evidence.js?v=545'"), 'petty evidence runtime must load on demand');
assert.doesNotMatch(pageSource, /<script src="operations-petty-cash-evidence\.js\?v=/, 'petty evidence module must not block the initial report view');
assert.doesNotMatch(pageSource, /<script src="operations-monthly-summary\.js\?v=/, 'disabled monthly summary must not load for every user');
assert.ok(apiSource.includes('pending_voucher_requests: pendingVoucherRequests'), 'pending formal upload state not returned');
assert.ok(apiSource.includes('upload_history_evidence') && apiSource.includes('upload_voucher'), 'per-role upload permissions missing');
assert.match(apiSource, /entry_type=in\.\(monthly_profit_loss,salary,petty_cash,employee_purchase\)/);
assert.match(migration, /entry\.entry_type in \([\s\S]*?'petty_cash'[\s\S]*?'employee_purchase'/);
assert.match(migration, /revoke execute on function public\.zysyr_attach_history_ledger_evidence[\s\S]*?from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.zysyr_attach_history_ledger_evidence[\s\S]*?to service_role/);
assert.doesNotMatch(migration, /update\s+public\.zysyr_history_ledger_entries/i, 'evidence upload must never rewrite posted amount');

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
  let pettyModuleRequested = false;
  page.on('request', request => { if (request.url().includes('operations-petty-cash-evidence.js')) pettyModuleRequested = true; });
  assert.equal(pettyModuleRequested, false, 'petty evidence module must stay unloaded on the initial monthly view');
  await page.evaluate(() => showView('finance-workbench'));
  await page.waitForFunction(() => window.ZysyrPettyCashEvidenceReady === true);
  assert.equal(pettyModuleRequested, true, 'petty evidence module must load when entering its finance view');
  await page.evaluate(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=';
    const formalA = { id: '11111111-1111-4111-8111-111111111111', transaction_date: '2026-01-02', direction: 'outflow', category: '食品', summary: '正式单笔', amount: 20, status: 'confirmed' };
    const formalB = { id: '22222222-2222-4222-8222-222222222222', transaction_date: '2026-01-03', direction: 'outflow', category: '用品', summary: '待审核单笔', amount: 30, status: 'confirmed' };
    const historyA = { id: '33333333-3333-4333-8333-333333333333', import_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transaction_date: '2026-01-05', direction: 'outflow', category: '食品', summary: '柠檬', amount: 21.8, voucher_number: '2', source_locator: '01!A9:H9', version: 1, historical: true };
    const historyB = { id: '44444444-4444-4444-8444-444444444444', import_row_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', transaction_date: '2026-01-06', direction: 'outflow', category: '日用', summary: '纸巾', amount: 11.8, voucher_number: '3', source_locator: '01!A10:H10', version: 1, historical: true };
    window.fixture = {
      records: [formalA, formalB], daily_reports: [], daily_lines: [], source_cells: [], source_reports: [], users: [], opening_balance: 0,
      voucher_links: [], vouchers: [],
      pending_voucher_requests: [{ id: 'pending-b', voucher_id: 'pending-voucher', business_type: 'petty_cash_record', business_id: formalB.id, status: 'pending' }],
      history_records: [historyA, historyB],
      history_evidence: [{ id: '55555555-5555-4555-8555-555555555555', original_filename: '2026年1月备用金支出凭证.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
      history_evidence_links: [
        { import_row_id: historyA.import_row_id, evidence_id: '55555555-5555-4555-8555-555555555555', source_locator: 'bundle:2026-01', link_level: 'bundle_only' },
        { import_row_id: historyA.import_row_id, evidence_id: '55555555-5555-4555-8555-555555555555', source_locator: 'word/media/image2.jpeg', link_level: 'page_confirmed' },
        { import_row_id: historyB.import_row_id, evidence_id: '55555555-5555-4555-8555-555555555555', source_locator: 'bundle:2026-01', link_level: 'bundle_only' }
      ],
      permissions: { read: true, upload_voucher: true, upload_history_evidence: true }
    };
    window.fixtureCalls = [];
    isLocalPreview = () => false;
    api = async function (operation, payload) {
      window.fixtureCalls.push({ operation, ...payload });
      if (operation === 'petty_cash_report') return window.fixture;
      if (operation === 'history_evidence_images') {
        if (payload.evidence_id === '66666666-6666-4666-8666-666666666666') return { filename: '补传纸巾.png', mime_type: 'image/png', images: [{ filename: 'receipt.png', data_url: png }] };
        return { filename: '2026年1月备用金支出凭证.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', images: [{ filename: 'image1.jpeg', data_url: png }, { filename: 'image2.jpeg', data_url: png }] };
      }
      if (operation === 'history_ledger_evidence_upload') {
        window.fixture.history_evidence.push({ id: '66666666-6666-4666-8666-666666666666', original_filename: payload.filename, mime_type: payload.mime_type });
        window.fixture.history_evidence_links.push({ import_row_id: historyB.import_row_id, evidence_id: '66666666-6666-4666-8666-666666666666', source_locator: 'manual-upload:fixture', link_level: 'page_confirmed' });
        return { saved: true };
      }
      if (operation === 'voucher_upload') {
        window.fixture.pending_voucher_requests.push({ id: 'pending-a', voucher_id: 'new', business_type: 'petty_cash_record', business_id: formalA.id, status: 'pending' });
        return { uploaded: true };
      }
      throw Error('Unexpected API call: ' + operation);
    };
    state.finance.data = { categories: [], approved_vouchers: [] };
    loadFinanceWorkbench = async function () {};
    loadPettyCashReport = async function () {
      state.pettyCash.data = window.fixture;
      renderPettyCashReport();
    };
    await showView('finance-workbench');
  });

  await page.locator('.petty-evidence-item').first().waitFor();
  assert.equal(await page.locator('.petty-evidence-item').count(), 2);
  assert.equal(await page.locator('.petty-evidence-item.missing').count(), 1);
  assert.match(await page.locator('.petty-evidence-panel').innerText(), /凭证已对应 1 笔[\s\S]*待补 1 笔/);
  assert.equal(await page.locator('[data-history-petty-card]').first().evaluate(node => getComputedStyle(node.parentElement).gridTemplateColumns.split(' ').length), 1, 'phone view must use one readable column');
  assert.match(await page.locator('tr').filter({ hasText: '待审核单笔' }).innerText(), /已上传，等待审核/);
  assert.equal(await page.locator('tr').filter({ hasText: '待审核单笔' }).locator('[data-petty-exact-upload]').count(), 0, 'pending formal voucher must block duplicate click');

  await page.locator('[data-history-petty-open="33333333-3333-4333-8333-333333333333"]').click();
  await page.locator('#history-petty-file-list img').waitFor();
  assert.equal(await page.locator('#history-petty-file-list img').count(), 1, 'one history item must show only its exact image, not the whole bundle');
  assert.match(await page.locator('#trace-content').innerText(), /只显示与当前这一笔精确对应的原图/);

  const closeTraceResult = await page.evaluate(() => { closeTrace(); return true; });
  assert.equal(closeTraceResult, true);
  const photo = { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=', 'base64') };
  let chooser = page.waitForEvent('filechooser');
  await page.locator('[data-history-petty-card="44444444-4444-4444-8444-444444444444"] [data-petty-exact-upload]').click();
  await (await chooser).setFiles(photo);
  await page.locator('#petty-upload-confirm').waitFor();
  assert.match(await page.locator('#trace-content').innerText(), /确认上传到这一笔[\s\S]*纸巾[\s\S]*11\.80/);
  await page.locator('#petty-upload-confirm').click();
  await page.waitForFunction(() => window.fixtureCalls.filter(call => call.operation === 'history_ledger_evidence_upload').length === 1);
  await page.waitForFunction(() => document.getElementById('finance-workbench-status').textContent.includes('已直接对应到这一笔'));
  const historyUpload = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'history_ledger_evidence_upload'));
  assert.equal(historyUpload.ledger_entry_id, '44444444-4444-4444-8444-444444444444');
  assert.equal(await page.locator('#history-petty-file-list img').count(), 1, 'manual exact upload must preview as the selected item receipt');

  await page.evaluate(() => closeTrace());
  chooser = page.waitForEvent('filechooser');
  await page.locator('tr').filter({ hasText: '正式单笔' }).locator('[data-petty-exact-upload]').click();
  await (await chooser).setFiles(photo);
  await page.locator('#petty-upload-confirm').click();
  await page.waitForFunction(() => window.fixtureCalls.filter(call => call.operation === 'voucher_upload').length === 1);
  const formalUpload = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'voucher_upload'));
  assert.equal(formalUpload.business_type, 'petty_cash_record');
  assert.equal(formalUpload.business_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(formalUpload.skip_ocr, true);
  await page.waitForFunction(() => document.getElementById('finance-workbench-status').textContent.includes('等待财务审核'));
  assert.equal(await page.locator('tr').filter({ hasText: '正式单笔' }).locator('[data-petty-exact-upload]').count(), 0, 'successful formal upload must immediately disable duplicate upload');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => renderPettyCashReport());
  assert.equal(await page.locator('[data-history-petty-card]').first().evaluate(node => getComputedStyle(node.parentElement).gridTemplateColumns.split(' ').length), 2, 'desktop view must use two readable columns');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'desktop page must not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('v519 browser: per-item history image, direct upload, formal pending state and responsive layouts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
});
