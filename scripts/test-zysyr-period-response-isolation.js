/* Synthetic browser regression: stale period/store responses must never replace current page data. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});

let browser;
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/operations.html?preview=1&role=finance');
  await page.locator('#monthly-sheet').waitFor();

  const cases = [
    { view: 'finance-workbench', loader: 'loadFinanceWorkbench', operations: ['finance_workbench'], state: 'finance' },
    { view: 'finance-workbench', loader: 'loadPettyCashReport', operations: ['petty_cash_report'], state: 'pettyCash' },
    { view: 'payroll', loader: 'loadPayroll', operations: ['payroll_center'], state: 'payroll' },
    { view: 'salary-report', loader: 'loadSalaryReport', operations: ['payroll_center', 'salary_sheet_read'], state: 'salary' },
    { view: 'inventory', loader: 'loadInventory', operations: ['inventory_center'], state: 'inventory' }
  ];

  for (const test of cases) {
    for (const staleOutcome of ['late-success', 'late-error']) {
    await page.evaluate(({ view, loader, operations }) => {
      const select = document.getElementById('store-select');
      if (!Array.from(select.options).some(option => option.value === '第二门店')) select.add(new Option('第二门店', '第二门店'));
      select.value = '太合中心店';
      document.getElementById('month').value = '2026-01';
      state.view = view;
      state.readRequests = {};
      state.finance.data = null;
      state.pettyCash.data = null;
      state.payroll.data = null;
      state.salarySheet.data = null;
      state.inventory.data = null;
      window.isLocalPreview = () => false;
      window.__pendingReads = [];
      window.__readResolvers = {};
      window.api = (operation, payload) => new Promise((resolve, reject) => {
        const key = operation + ':' + payload.month;
        window.__pendingReads.push({ operation, store: payload.store, month: payload.month });
        window.__readResolvers[key] = { resolve, reject };
      });
      window.renderFinanceWorkbench = window.renderPettyCashReport = window.renderSalaryReport = window.renderPayroll = window.renderCheckRecordPanel = window.renderInventory = window.renderInventoryExtras = window.prefillPayment = () => {};
      window.__readCase = { view, loader, operations };
    }, test);

    await page.evaluate(() => {
      window.__oldRead = window[window.__readCase.loader]();
      document.getElementById('month').value = '2026-02';
      document.getElementById('store-select').value = '第二门店';
      window.__newRead = window[window.__readCase.loader]();
    });
    const calls = await page.evaluate(() => window.__pendingReads);
    assert.equal(calls.length, test.operations.length * 2, test.loader + ' should issue the expected read set twice');
    assert(calls.every(call => call.month === '2026-01' || call.month === '2026-02'), test.loader + ' must snapshot the requested month');
    assert(calls.filter(call => call.month === '2026-01').every(call => call.store === '太合中心店'), test.loader + ' old request must keep its original store');
    assert(calls.filter(call => call.month === '2026-02').every(call => call.store === '第二门店'), test.loader + ' new request must use the newly selected store');

    await page.evaluate(({ staleOutcome }) => {
      for (const operation of window.__readCase.operations) {
        const old = window.__readResolvers[operation + ':2026-01'];
        const current = window.__readResolvers[operation + ':2026-02'];
        // Current page wins first; both stale successes and failures arriving later must be ignored.
        if (current) current.resolve({ marker: 'current', month: '2026-02', operation });
        if (old && staleOutcome === 'late-success') old.resolve({ marker: 'old', month: '2026-01', operation });
        else if (old) old.reject(new Error('stale request failed after the current response'));
      }
    }, { staleOutcome });
    await page.evaluate(() => Promise.all([window.__oldRead, window.__newRead]));

    const snapshot = await page.evaluate(testCase => ({
      finance: state.finance.data,
      pettyCash: state.pettyCash.data,
      payroll: state.payroll.data,
      salaryPayroll: state.payroll.data,
      salarySheet: state.salarySheet.data,
      inventory: state.inventory.data,
      status: document.getElementById(testCase.view === 'payroll' ? 'payroll-status' : testCase.view === 'salary-report' ? 'salary-report-status' : testCase.view === 'inventory' ? 'inventory-status' : 'finance-workbench-status').textContent
    }), test);
    const target = test.state === 'salary' ? snapshot.salarySheet : snapshot[test.state];
    assert.equal(target && target.marker, 'current', test.loader + ' must keep the latest response');
    assert.equal(target && target.month, '2026-02', test.loader + ' must not display the old period');
    if (test.state === 'salary') {
      assert.equal(snapshot.salaryPayroll && snapshot.salaryPayroll.marker, 'current', 'salary report must preserve current payroll-center data');
      assert.equal(snapshot.salaryPayroll && snapshot.salaryPayroll.month, '2026-02', 'salary report payroll data must stay in the selected period');
    }
    assert.match(snapshot.status, /已更新/, test.loader + ' should leave a successful current-period status');
    }
  }

  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('period response isolation passed: finance workbench, petty cash, payroll, salary, inventory; month/store race, stale late successes and errors');
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
run().catch(async error => {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  server.close();
  process.exitCode = 1;
});
