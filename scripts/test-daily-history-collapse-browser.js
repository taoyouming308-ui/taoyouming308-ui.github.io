const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), origin = 'http://127.0.0.1:43829';
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.addInitScript(() => { Element.prototype.scrollIntoView = function () {}; });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    });
    await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent('合成演示门店'));
    await page.locator('#monthly-sheet .sheet-table').waitFor();
    await page.evaluate(() => showView('daily-report'));
    const openDay = async () => { await page.locator('#daily-report-calendar .daily-day[data-draft-id]').first().click(); await page.locator('#daily-detail-grid .daily-grid').waitFor(); if(await page.evaluate(()=>state.user.can_read_daily_history===true))await page.evaluate(()=>{state.imports.sheet.permissions.read_history=true;renderDailyDetailHistory()}); };
    await openDay();
    assert.equal(await page.locator('#daily-history-panel').isVisible(), false, 'finance does not see audit history');
    await page.evaluate(() => { state.user.can_read_daily_history = true; state.imports.sheet = previewDailySheetData(); state.imports.sheet.permissions.read_history = true; state.imports.sheet.history=[{changed_at:'2026-10-11T12:00:00Z',changed_by_name:'合成测试账号',before_value:20,after_value:25,reason:'合成验收示例',row_label:'演示行',column_label:'演示字段'}]; renderDailySheetDetail(); });
    const button = page.locator('#daily-history-toggle'), body = page.locator('#daily-history-body');
    const closed = async () => { await assert.equal(await button.getAttribute('aria-expanded'), 'false'); assert.equal(await body.isVisible(), false); assert.equal(await button.textContent(), '查看修改记录'); };
    await closed();
    assert.equal(await button.getAttribute('type'), 'button');
    assert.equal(await button.getAttribute('aria-controls'), 'daily-history-body');
    assert.ok(await button.evaluate(n => n.getBoundingClientRect().height) >= 44);
    const audit = await page.evaluate(() => JSON.stringify(state.imports.sheet.history));
    const auditText = await page.locator('#daily-detail-history').textContent();
    for (let i = 0; i < 4; i++) { await button.click(); assert.equal(await body.isVisible(), i % 2 === 0); }
    await closed();
    await button.focus(); await button.press('Enter'); assert.equal(await body.isVisible(), true);
    await button.press('Space'); await closed();
    assert.equal(await page.evaluate(() => JSON.stringify(state.imports.sheet.history)), audit);
    assert.equal(await page.locator('#daily-detail-history').textContent(), auditText);
    if (process.env.DAILY_HISTORY_SCREENSHOT_DIR) {
      const directory = process.env.DAILY_HISTORY_SCREENSHOT_DIR; fs.mkdirSync(directory, { recursive: true });
      const device = width === 390 ? 'mobile' : 'desktop';
      await page.locator('#daily-history-panel').screenshot({ style: '.topbar{visibility:hidden!important}', path: path.join(directory, 'daily-history-' + device + '-closed.png') });
      await button.click();
      await page.locator('#daily-history-panel').screenshot({ style: '.topbar{visibility:hidden!important}', path: path.join(directory, 'daily-history-' + device + '-open.png') });
    } else await button.click();
    await page.locator('#daily-readonly-back').click(); await openDay(); await closed();
    await button.click(); await page.evaluate(() => showView('monthly'));
    await page.evaluate(() => showView('daily-report')); await openDay(); await closed();
    await button.click();
    await page.evaluate(() => { document.getElementById('store-select').add(new Option('合成门店B', '合成门店B')); document.getElementById('store-select').disabled=false; });
    await page.locator('#store-select').selectOption('合成门店B'); await openDay(); await closed();
    await button.click();
    await page.evaluate(() => { const n = document.getElementById('month'); if (!n.querySelector('option[value="2026-09"]')) n.add(new Option('2026年9月', '2026-09')); });
    await page.locator('#month').selectOption('2026-09'); await openDay(); await closed();
    await page.locator('#daily-readonly-back').click(); await page.locator('#daily-month-prev').click(); await openDay(); await closed();
    const input = page.locator('#daily-detail-grid input[data-daily-cell]:not([readonly])').first();
    await input.fill('123.45'); await page.locator('#daily-detail-reason').evaluate(n=>n.closest('details').open=true); await page.locator('#daily-detail-reason').fill('合成未保存说明');
    const snapshot = () => page.evaluate(() => ({ values: Array.from(document.querySelectorAll('#daily-detail-grid input')).map(n => [n.dataset.dailyCell, n.value, n.readOnly]), dirty: JSON.stringify(state.imports.dirty), labels: JSON.stringify(state.imports.dirtyLabels), reason: document.getElementById('daily-detail-reason').value, store: document.getElementById('store-select').value, month: document.getElementById('month').value, history: JSON.stringify(state.imports.sheet.history), warnings: document.getElementById('daily-detail-controls').textContent }));
    const before = await snapshot();
    await button.click(); await button.click(); assert.deepEqual(await snapshot(), before, 'fold never changes pending work or warnings');
    await page.locator('#store-select').selectOption('合成演示门店'); assert.deepEqual(await snapshot(), before, 'cancelled dirty store navigation preserves work');
    await page.locator('#month').selectOption('2026-09'); assert.deepEqual(await snapshot(), before, 'cancelled dirty month navigation preserves work');
    await page.locator('#daily-readonly-back').click(); assert.deepEqual(await snapshot(), before, 'cancelled dirty return preserves work');
    assert.ok(await page.locator('#daily-detail-controls .daily-control.bad').first().isVisible(), 'true amount warnings remain visible');
    await page.evaluate(()=>{state.user.can_read_daily_history=false;refreshRoleEntries()});
    assert.equal(await page.locator('#daily-history-panel').isVisible(),false);
    assert.equal(await page.locator('#daily-detail-history').textContent(),'');
    assert.equal(await page.evaluate(()=>Object.hasOwn(state.imports.sheet,'history')),false,'old owner in-memory audit cleared after access downgrade');
    assert.equal(await input.inputValue(),'123.45','access downgrade does not clear unsaved amounts');
    assert.equal(await page.locator('#daily-detail-reason').inputValue(),'合成未保存说明');
    await page.evaluate(async()=>{
      state.user.can_read_daily_history=true;state.imports.sheet=previewDailySheetData();state.imports.sheet.permissions.read_history=true;renderDailySheetDetail();
      window.syntheticLateSheet=structuredClone(state.imports.sheet);window.confirm=()=>true;api=async()=>({});authBridge.signOut=async()=>{};await logout();
    });
    assert.equal(await page.evaluate(()=>state.user),null);
    assert.equal(await page.evaluate(()=>Object.hasOwn(state.imports.sheet,'history')),false,'logout clears cached audit');
    assert.equal(await page.locator('#daily-detail-history').textContent(),'');
    await page.evaluate(()=>{state.imports.sheet=structuredClone(window.syntheticLateSheet);renderDailyDetailHistory();});
    assert.equal(await page.evaluate(()=>Object.hasOwn(state.imports.sheet,'history')),false,'late old-account response cannot restore audit after logout');
    assert.equal(await page.locator('#daily-history-panel').isVisible(),false);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(width + ': defaults, repeat/keyboard/touch, return/view/store/month reset, audit preservation and dirty cancellation passed');
    await page.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
