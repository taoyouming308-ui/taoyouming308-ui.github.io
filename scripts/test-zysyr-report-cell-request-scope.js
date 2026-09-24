/* Browser regression: a slow prior report must never replace the selected report's source cells. */
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
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/javascript');
    res.end(bytes);
  });
});
let browser;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/operations.html?preview=1&role=finance');
  await page.evaluate(() => showView('payroll'));
  await page.locator('#salary-source-report').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('payroll-status').textContent.startsWith('已更新'));

  await page.evaluate(() => {
    state.view = 'payroll';
    isLocalPreview = () => false;
    window.pendingReportCells = {};
    api = (operation, payload) => {
      if (operation !== 'report_cells') throw new Error('Unexpected operation: ' + operation);
      return new Promise((resolve, reject) => { pendingReportCells[payload.report_id] = { resolve, reject }; });
    };
    ['salary-source-report', 'performance-source-report'].forEach(id => {
      const select = document.getElementById(id);
      select.innerHTML = '<option value="">请选择</option><option value="report-A">原表 A</option><option value="report-B">原表 B</option>';
    });
  });

  // Salary source: B wins; A arrives late with an error and cannot replace B's choices.
  await page.locator('#salary-source-report').selectOption('report-A');
  await page.locator('#salary-source-report').selectOption('report-B');
  await page.waitForFunction(() => pendingReportCells['report-A'] && pendingReportCells['report-B']);
  await page.evaluate(() => pendingReportCells['report-B'].resolve({ cells: [
    { id: 'B-base', label: '底薪', cell_address: 'C5', row_number: 5, numeric_value: 6000 },
    { id: 'B-social', label: '社保', cell_address: 'J5', row_number: 5, numeric_value: 1306.33 },
    { id: 'B-other', label: '其他调整', cell_address: 'K5', row_number: 5, numeric_value: 100 }
  ] }));
  await page.waitForFunction(() => document.querySelector('#salary-base-cell option[value="B-base"]'));
  await page.evaluate(() => pendingReportCells['report-A'].reject(new Error('旧原表请求失败')));
  await page.waitForTimeout(25);
  for (const id of ['salary-base-cell', 'salary-social-cell', 'salary-other-cell']) {
    const values = await page.locator('#' + id + ' option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    assert.deepEqual(values, ['B-base', 'B-social', 'B-other'], id + ' must retain only the selected report B cells');
  }

  // Clearing a salary source invalidates its in-flight response.
  await page.locator('#salary-source-report').selectOption('report-A');
  await page.locator('#salary-source-report').selectOption('');
  await page.evaluate(() => pendingReportCells['report-A'].resolve({ cells: [
    { id: 'A-late', label: '过期底薪', cell_address: 'C5', row_number: 5, numeric_value: 9999 }
  ] }));
  await page.waitForTimeout(25);
  assert.match(await page.locator('#salary-base-cell').innerText(), /请先选择工资原表/);
  assert.equal(await page.locator('#salary-base-cell option[value="A-late"]').count(), 0);

  // Hairstylist performance source uses the same scope protection.
  await page.locator('#performance-source-report').selectOption('report-A');
  await page.locator('#performance-source-report').selectOption('report-B');
  await page.waitForFunction(() => pendingReportCells['report-B']);
  await page.evaluate(() => pendingReportCells['report-B'].resolve({ cells: [
    { id: 'B-performance', label: '实做', cell_address: 'G8', row_number: 8, numeric_value: 1234 }
  ] }));
  await page.waitForFunction(() => document.querySelector('#performance-source-cell option[value="B-performance"]'));
  await page.evaluate(() => pendingReportCells['report-A'].resolve({ cells: [
    { id: 'A-performance-late', label: '过期实做', cell_address: 'G8', row_number: 8, numeric_value: 9999 }
  ] }));
  await page.waitForTimeout(25);
  assert.equal(await page.locator('#performance-source-cell option[value="B-performance"]').count(), 1);
  assert.equal(await page.locator('#performance-source-cell option[value="A-performance-late"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Report cell source request scope: stale salary/performance report responses ignored');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
