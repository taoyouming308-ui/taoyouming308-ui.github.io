#!/usr/bin/env node
// Browser-only regression with synthetic data; never connects to production.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260913113354_zysyr_monthly_editable_names.sql'), 'utf8');
for (const marker of [
  'data-monthly-text-cell', 'monthlyTextChanged', 'monthly_text_save',
  'editable_text_cells', '保存本月修改', '编辑月报',
]) assert.ok(source.includes(marker), 'missing UI marker ' + marker);
for (const marker of ['monthlyEditableNameCells', 'monthlyTextSave', 'zysyr_monthly_text_revisions']) {
  assert.ok(apiSource.includes(marker), 'missing API marker ' + marker);
}
for (const marker of ['enable row level security', 'force row level security', 'MONTHLY_TEXT_CHANGED_RELOAD', 'monthly_text_change']) {
  assert.ok(migration.includes(marker), 'missing migration guard ' + marker);
}

const helperNames = ['cleanText', 'columnLetters', 'monthlyEditableNameCells'];
const helperCode = helperNames.map(name => {
  const start = apiSource.indexOf('function ' + name + '(');
  const end = apiSource.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, 'missing helper ' + name);
  return apiSource.slice(start, end);
}).join('\n');
const helperContext = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(helperCode), helperContext);
const values = Array.from({ length: 75 }, () => Array(22).fill(''));
const put = (row, column, value) => { values[row - 1][column - 1] = value; };
put(2, 2, '收入类别'); put(2, 5, '编号'); put(2, 6, '姓名'); put(9, 2, '支出类别'); put(60, 1, '备注：');
put(3, 1, '主营'); put(3, 2, '美发收入'); put(8, 1, '小计'); put(8, 2, '小计');
put(10, 1, '房租'); put(10, 2, '房租'); put(14, 1, '小计'); put(14, 2, '小计');
put(3, 4, '技术人员'); put(3, 5, '01'); put(3, 6, '哈维'); put(23, 5, '小计'); put(23, 6, '小计');
put(24, 4, '后勤'); put(24, 5, '21'); put(24, 6, '叶钰'); put(29, 5, '小计'); put(30, 4, '合计');
put(31, 4, '产品进货'); put(31, 5, '歌薇'); put(31, 10, '备用金'); put(31, 11, '日用品');
put(44, 4, '零售产品成本'); put(44, 5, '卡诗'); put(44, 10, '杂项');
const merges = [
  [2, 3, 22, 3], [23, 3, 28, 3], [30, 3, 41, 3], [43, 3, 51, 3],
  [30, 9, 41, 9], [43, 9, 51, 9],
].map(([start_row, start_col, end_row, end_col]) => ({ start_row, start_col, end_row, end_col }));
const inferred = new Map(helperContext.monthlyEditableNameCells({ rows: 75, columns: 22, values, merges }).map(item => [item.cell_address, item]));
for (const address of ['B3', 'B10', 'F3', 'F12', 'F24', 'E31', 'E42', 'E44', 'E52', 'K31', 'K42', 'K44', 'K52']) {
  assert.ok(inferred.has(address), address + ' must be inferred as an editable name');
}
for (const address of ['B2', 'B8', 'B9', 'B14', 'E3', 'F23', 'F29', 'D30', 'E43']) {
  assert.equal(inferred.has(address), false, address + ' must remain structural/read-only');
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
  await page.waitForFunction(() => state.user && state.user.role === 'finance');
  await page.evaluate(() => renderAll());
  await page.locator('#monthly-edit-toggle').waitFor();
  await page.evaluate(() => {
    const display = state.data.monthly_report.display_data;
    display.editable_text_cells = [
      { cell_address: 'B3', row_number: 3, column_number: 2, cell_role: 'income_item', original_text: '美发收入', current_text: '美发收入', revision: null },
      { cell_address: 'F12', row_number: 12, column_number: 6, cell_role: 'staff_name', original_text: '', current_text: '', revision: null },
      { cell_address: 'E40', row_number: 40, column_number: 5, cell_role: 'detail_name', original_text: '杭汐', current_text: '杭汐', revision: null },
    ];
    window.fixtureOverview = JSON.parse(JSON.stringify(state.data));
    window.savedText = [];
    isLocalPreview = () => false;
    api = async (operation, payload) => {
      if (operation === 'monthly_text_save') {
        savedText.push(payload);
        for (const change of payload.cells) {
          const target = fixtureOverview.monthly_report.display_data.editable_text_cells.find(item => item.cell_address === change.address);
          target.current_text = change.value;
          target.revision = { revision: change.expected_revision + 1, after_text: change.value };
          const column = columnNumber(change.address.match(/^[A-Z]+/)[0]);
          const row = Number(change.address.match(/\d+$/)[0]) - 1;
          fixtureOverview.monthly_report.display_data.values[row][column] = change.value;
        }
        return { saved: { count: payload.cells.length } };
      }
      if (operation === 'overview') return JSON.parse(JSON.stringify(fixtureOverview));
      throw new Error('Unexpected operation ' + operation);
    };
    state.monthlyEditMode = true;
    renderMonthlyAuditControls(true);
  });

  for (const address of ['B3', 'F12', 'E40']) {
    assert.equal(await page.locator(`input[data-monthly-text-cell="${address}"]`).count(), 1, address + ' must be editable');
  }
  assert.equal(await page.locator('input[data-monthly-text-cell="B2"]').count(), 0, 'header must stay fixed');
  assert.equal(await page.locator('input[data-monthly-text-cell="E3"]').count(), 0, 'employee number must stay fixed');
  assert.equal(await page.locator('input[data-monthly-text-cell="B8"]').count(), 0, 'subtotal name must stay fixed');
  assert.equal(await page.locator('input[data-monthly-text-cell="F12"]').evaluate(node => getComputedStyle(node).boxShadow !== 'none'), true, 'blank staff name needs a visible boundary');

  await page.locator('input[data-monthly-text-cell="B3"]').fill('剪发收入');
  await page.locator('input[data-monthly-text-cell="F12"]').fill('新员工');
  await page.locator('input[data-monthly-text-cell="E40"]').fill('新品牌');
  assert.match(await page.locator('#monthly-save-cells').innerText(), /3/);
  page.once('dialog', dialog => dialog.accept('财务核对名称'));
  await page.locator('#monthly-save-cells').click();
  await page.waitForFunction(() => savedText.length === 1 && state.monthlyEditMode === false);
  const saved = await page.evaluate(() => savedText[0]);
  assert.deepEqual(saved.cells.map(item => [item.address, item.value]), [['B3', '剪发收入'], ['F12', '新员工'], ['E40', '新品牌']]);
  assert.equal(await page.locator('#monthly-sheet').getByText('剪发收入', { exact: true }).count(), 1);
  assert.equal(await page.locator('#monthly-sheet').getByText('新员工', { exact: true }).count(), 1);
  assert.equal(await page.locator('#monthly-sheet').getByText('新品牌', { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('v500 browser: income/expense item, blank staff and detail names edit, audit payload, save/readback and fixed-cell guards passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
});
