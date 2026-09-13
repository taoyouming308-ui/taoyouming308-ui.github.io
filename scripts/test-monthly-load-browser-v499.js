/* Browser regressions: real-shaped report, load failure, edit/readback, scope races. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let real = null;
if (process.env.ZYSYR_MONTHLY_FIXTURE) {
  real = JSON.parse(fs.readFileSync(process.env.ZYSYR_MONTHLY_FIXTURE, 'utf8'));
  const source = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
  const names = ['cleanText', 'mergeCoordinates', 'columnLetters', 'formulaPrecedents', 'safeFormulaValue', 'monthlyItemCategory', 'latestMonthlyCellRevisionMap', 'effectiveMonthlyDisplay', 'isDailyIncomeCell'];
  const code = names.map(name => { const start = source.indexOf('function ' + name + '('); return source.slice(start, source.indexOf('\n}', start) + 2); }).join('\n');
  const context = vm.createContext({});
  vm.runInContext(stripTypeScriptTypes(code), context);
  real.display_data = context.effectiveMonthlyDisplay(real.display_data, real.cells, [], [], null);
}
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, bytes) => {
    if (err) return res.writeHead(404).end();
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + '/operations.html?preview=1&role=finance');
  await page.locator('#monthly-edit-toggle').waitFor();
  await page.evaluate(realReport => {
    if (realReport) state.data.monthly_report = Object.assign({}, state.data.monthly_report, realReport);
    state.data.monthly_report.historical = false;
    window.fixtureOverview = JSON.parse(JSON.stringify(state.data));
    window.calls = []; window.failOverview = false;
    isLocalPreview = () => false;
    api = async (operation, payload) => {
      calls.push({ operation, ...payload });
      if (operation === 'overview') {
        if (failOverview) throw apiError({ error: 'SendRequest ' + 'private-id,'.repeat(450) }, 503);
        return JSON.parse(JSON.stringify(fixtureOverview));
      }
      if (operation === 'monthly_editable_slots_prepare') return { prepared: 0 };
      throw Error('Unexpected operation ' + operation);
    };
  }, real);
  await page.evaluate(() => loadOverview());
  await page.locator('#monthly-edit-toggle').click();
  await page.waitForFunction(() => state.monthlyEditMode === true, null, { timeout: 5000 }).catch(async error => {
    console.error(await page.evaluate(() => ({ mode: state.monthlyEditMode, ready: state.monthlyOverviewReady, status: document.getElementById('sync-status').innerText, calls: calls.map(c => c.operation), month: document.getElementById('month').value, store: currentStore(), toast: document.getElementById('toast')?.innerText })));
    throw error;
  });
  const expected = real ? ['C6', 'C7', 'C11', 'C12', 'C13', 'C17', 'C18', 'G14', 'M14'] : ['G12', 'M12'];
  for (const address of expected) {
    const input = page.locator('input[data-monthly-cell="' + address + '"]');
    assert.equal(await input.count(), 1, address + ' must be editable');
    assert.equal(await input.inputValue(), '', address + ' must stay blank until filled');
    assert.equal(await input.evaluate(node => getComputedStyle(node).boxShadow !== 'none'), true, address + ' requires a visible boundary');
  }
  assert.equal(await page.locator('input[data-monthly-cell="E14"]').count(), 0, 'fixed identifiers');
  const target = expected[0];
  await page.locator('input[data-monthly-cell="' + target + '"]').fill('12.50');
  assert.equal(await page.locator('#monthly-save-cells').isVisible(), true);
  assert.match(await page.locator('#monthly-save-cells').innerText(), /1/);
  // Simulate persistence only in the isolated fixture; never write test amounts to production.
  await page.evaluate(address => {
    window.savedChanges = [];
    saveMonthlyAmountAdjustment = async (change, reason) => {
      savedChanges.push({ change, reason });
      const cell = fixtureOverview.monthly_report.display_data.cells.find(c => c.cell_address === address);
      cell.numeric_value = Number(change.value); cell.display_value = change.value;
      fixtureOverview.monthly_report.display_data.values[cell.row_number - 1][cell.column_number - 1] = Number(change.value);
      return { saved: true };
    };
  }, target);
  page.once('dialog', dialog => dialog.accept('本地隔离测试，不写生产账'));
  await page.locator('#monthly-save-cells').click();
  await page.waitForFunction(() => savedChanges.length === 1 && state.monthlyEditMode === false);
  assert.equal(await page.evaluate(address => state.data.monthly_report.display_data.cells.find(c => c.cell_address === address).numeric_value, target), 12.5);
  // Failed prepare readback must not announce success, retain old table, or create a new month.
  await page.evaluate(() => { failOverview = true; });
  await page.locator('#monthly-edit-toggle').click();
  await page.waitForFunction(() => state.monthlyOverviewReady === false && document.getElementById('monthly-sheet').innerText.includes('加载失败'));
  assert.equal(await page.locator('#monthly-edit-toggle').isDisabled(), true);
  assert.equal(await page.locator('input[data-monthly-cell]').count(), 0);
  assert.doesNotMatch(await page.locator('#sync-status').innerText(), /private-id|SendRequest/);
  assert.ok((await page.locator('#sync-status').innerText()).length < 100);
  assert.equal(await page.evaluate(() => calls.filter(c => c.operation === 'monthly_draft_create').length), 0);
  await page.evaluate(() => { failOverview = false; return loadOverview(); });
  assert.equal(await page.locator('#monthly-edit-toggle').isDisabled(), false);
  await page.locator('#monthly-edit-toggle').click();
  await page.waitForFunction(() => state.monthlyEditMode === true);
  assert.equal(await page.locator('#monthly-save-cells').isVisible(), true);
  // Late responses cannot replace a later month/store selection.
  await page.evaluate(async () => {
    state.monthlyDirty = {};
    window.pendingLoads = [];
    api = () => new Promise(resolve => pendingLoads.push(resolve));
    window.firstLoad = loadOverview(); window.secondLoad = loadOverview();
    pendingLoads[1](Object.assign({}, fixtureOverview, { response_marker: 'new' }));
    await secondLoad;
    pendingLoads[0](Object.assign({}, fixtureOverview, { response_marker: 'old' }));
    await firstLoad;
    if (state.data.response_marker !== 'new') throw Error('stale response replaced current report');
  });
  assert.deepEqual(errors, []);
  console.log('v499 browser: ' + (real ? real.cells.length + '-cell production read-only fixture' : 'synthetic fixture') + ', blank borders, editing/save/readback, error recovery and stale response isolation passed');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
