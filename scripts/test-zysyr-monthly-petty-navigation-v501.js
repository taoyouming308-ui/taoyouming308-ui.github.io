#!/usr/bin/env node
// Browser regression with preview data only; never reads or writes production.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
for (const marker of ['monthlyCellRoutesToPettyCash', 'openMonthlyPettyCashDetails', "data.item_category==='petty_cash_summary'"]) {
  assert.ok(html.includes(marker), 'missing monthly petty navigation marker ' + marker);
}
for (const marker of ['return "petty_cash_summary"', '"purchase_summary", "petty_cash_summary"']) {
  assert.ok(api.includes(marker), 'missing API petty summary marker ' + marker);
}
for (const view of ['finance-workbench', 'archive', 'history-import']) {
  assert.match(html, new RegExp('data-view="' + view + '"[^>]*style="display:none"'), view + ' must stay hidden in navigation');
}

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/operations.html?preview=1&role=finance');
  await page.waitForFunction(() => state.user && state.user.role === 'finance' && state.data.monthly_report);

  for (const view of ['finance-workbench', 'archive', 'history-import']) {
    assert.equal(await page.locator(`.nav [data-view="${view}"]`).evaluate(node => getComputedStyle(node).display), 'none');
  }

  const result = await page.evaluate(async () => {
    const cells = state.data.monthly_report.display_data.cells || [];
    const summary = cells.find(cell => /(^|[\/／])备用金$/.test(String(cell.label || '').replace(/\s/g, '')));
    if (!summary) throw new Error('preview monthly report has no petty-cash summary cell');
    cells.push({ cell_address: 'K31', label: '备用金 / 食品 / 合计' });
    const before = { store: currentStore(), month: document.getElementById('month').value };
    let financeLoads = 0, pettyLoads = 0;
    loadFinanceWorkbench = function () { financeLoads += 1; };
    loadPettyCashReport = function () { pettyLoads += 1; };
    await openMonthlyVoucher(summary.cell_address);
    return {
      summary: summary.cell_address,
      summaryRoutes: monthlyCellRoutesToPettyCash(summary.cell_address),
      detailRoutes: monthlyCellRoutesToPettyCash('K31'),
      view: state.view,
      storePreserved: currentStore() === before.store,
      monthPreserved: document.getElementById('month').value === before.month,
      financeLoads, pettyLoads,
      financeVisible: !document.getElementById('view-finance-workbench').classList.contains('hidden'),
      traceHidden: document.getElementById('view-cell-trace').classList.contains('hidden'),
    };
  });
  assert.equal(result.summaryRoutes, true, 'left petty-cash summary must route to details');
  assert.equal(result.detailRoutes, false, 'right-side petty detail must retain amount/voucher flow');
  assert.equal(result.view, 'finance-workbench');
  assert.equal(result.storePreserved, true);
  assert.equal(result.monthPreserved, true);
  assert.equal(result.financeLoads, 1);
  assert.equal(result.pettyLoads, 1);
  assert.equal(result.financeVisible, true);
  assert.equal(result.traceHidden, true);
  assert.deepEqual(errors, []);
  console.log('v501 browser: petty summary direct navigation, scoped month/store, hidden low-frequency nav and detail-cell guard passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
});
