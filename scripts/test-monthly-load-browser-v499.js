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
  const names = ['cleanText', 'mergeCoordinates', 'columnLetters', 'formulaPrecedents', 'reportCellLabel', 'monthlyEditableNameCells', 'safeFormulaValue', 'monthlyItemCategory', 'latestMonthlyCellRevisionMap', 'effectiveMonthlyDisplay', 'isDailyIncomeCell'];
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
  browser = await chromium.launch({ headless: true });
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
  const partiallySavedTarget = expected[1] || expected[0];
  await page.locator('input[data-monthly-cell="' + target + '"]').fill('12.50');
  if (partiallySavedTarget !== target) await page.locator('input[data-monthly-cell="' + partiallySavedTarget + '"]').fill('8.75');
  assert.equal(await page.locator('#monthly-save-cells').isVisible(), true);
  assert.match(await page.locator('#monthly-save-cells').innerText(), /2/);
  // A normal refresh must preserve local edits and stale source values must
  // remain guarded. All persistence below is isolated fixture data.
  await page.evaluate(() => loadOverview());
  assert.equal(await page.locator('input[data-monthly-cell="' + target + '"]').inputValue(), '12.50');
  if (partiallySavedTarget !== target) assert.equal(await page.locator('input[data-monthly-cell="' + partiallySavedTarget + '"]').inputValue(), '8.75');
  const originalMonth = await page.locator('#month').inputValue();
  await page.evaluate(async () => { window.confirm = () => false; await showView('daily-report');
    var picker = document.getElementById('month'); picker.value = picker.value.slice(0, 5) + '02'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => state.view), 'monthly', 'cancelled navigation must keep the unsaved month open');
  assert.equal(await page.locator('#month').inputValue(), originalMonth, 'cancelled month switch must keep unsaved values in their original scope');
  await page.evaluate(address => {
    window.savedChanges = []; window.expectedTarget = address; window.failSecondOnce = true;
    saveMonthlyAmountAdjustment = async (change, reason) => {
      savedChanges.push({ change, reason });
      if (change.address !== address && failSecondOnce) { failSecondOnce = false; throw Error('模拟第二格保存失败'); }
      const cell = fixtureOverview.monthly_report.display_data.cells.find(c => c.cell_address === address);
      if (change.address === address) {
        cell.numeric_value = Number(change.value); cell.display_value = change.value;
        fixtureOverview.monthly_report.display_data.values[cell.row_number - 1][cell.column_number - 1] = Number(change.value);
      } else {
        const other = fixtureOverview.monthly_report.display_data.cells.find(c => c.cell_address === change.address);
        other.numeric_value = Number(change.value); other.display_value = change.value;
        fixtureOverview.monthly_report.display_data.values[other.row_number - 1][other.column_number - 1] = Number(change.value);
      }
      return { saved: true };
    };
  }, target);
  page.once('dialog', dialog => dialog.accept('本地隔离测试，不写生产账'));
  await page.locator('#monthly-save-cells').click();
  await page.waitForFunction(() => savedChanges.length === 2);
  const partialState = await page.evaluate(address => ({ expected: window.expectedTarget, pending: state.monthlyDirty,
    second: address, mode: state.monthlyEditMode, saveText: document.getElementById('monthly-save-cells').innerText }), partiallySavedTarget);
  assert.equal(Boolean(partialState.pending[partialState.expected]), false, 'successfully saved cell must clear only after readback');
  assert.equal(Boolean(partialState.pending[partiallySavedTarget]), true, 'failed cell must remain pending after partial failure');
  assert.equal(await page.locator('input[data-monthly-cell="' + target + '"]').inputValue(), '12.5', 'successfully saved cell must reflect readback');
  assert.equal(await page.locator('input[data-monthly-cell="' + partiallySavedTarget + '"]').inputValue(), '8.75', 'failed cell must remain editable');
  assert.match(await page.locator('#monthly-save-cells').innerText(), /1/);
  await page.evaluate(address => { window.partiallySavedTarget = address; failOverview = true; }, partiallySavedTarget);
  await page.evaluate(() => loadOverview());
  assert.equal(await page.evaluate(address => state.monthlyDirty[address].value, partiallySavedTarget), '8.75', 'failed refresh must not clear dirty value');
  await page.evaluate(() => { failOverview = false; return loadOverview(); });
  assert.equal(await page.locator('input[data-monthly-cell="' + partiallySavedTarget + '"]').inputValue(), '8.75', 'successful refresh must restore failed value');
  await page.evaluate(() => { failSecondOnce = false; });
  page.once('dialog', dialog => dialog.accept('本地隔离测试，不写生产账'));
  await page.locator('#monthly-save-cells').click();
  await page.waitForFunction(address => !state.monthlyDirty[address] && !state.monthlyEditMode, partiallySavedTarget);
  assert.equal(await page.evaluate(address => state.data.monthly_report.display_data.cells.find(c => c.cell_address === address).numeric_value, target), 12.5);
  assert.equal(await page.evaluate(address => state.data.monthly_report.display_data.cells.find(c => c.cell_address === address).numeric_value, partiallySavedTarget), 8.75);
  // Failed refresh must retain local input, recover on retry, and keep existing scope isolation.
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
