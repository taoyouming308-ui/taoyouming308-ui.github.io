// Reviewed surface CSS must preserve report geometry and financial interaction state.
// Routes serve this checkout only; preview fixtures never contact production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43829';
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const css = html.match(/<style id="operations-surface-polish">([\s\S]*?)<\/style>/)?.[1];
assert.ok(css, 'reviewed surface stylesheet is present');
const allowed = new Set(['font-weight', 'letter-spacing', 'border-color', 'background', 'box-shadow', 'border-radius', 'font-variant-numeric']);
for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)) {
  for (const declaration of block[1].split(';').filter(value => value.trim())) {
    const property = declaration.split(':')[0].trim();
    assert.ok(allowed.has(property), 'surface polish must not change layout: ' + property);
  }
}
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    return route.fulfill({ body: fs.readFileSync(file), contentType });
  });
  const snapshot = () => page.evaluate(() => ({
    text: document.getElementById('app').textContent,
    inputs: Array.from(document.querySelectorAll('#app input,#app select')).map(node => [node.id, node.value, node.disabled, node.readOnly]),
    buttons: Array.from(document.querySelectorAll('#app button')).map(node => [node.id, node.textContent, node.disabled]),
    rects: Array.from(document.querySelectorAll('#app .topbar,#app .sidebar,#app .page-head,#app .nav button,#app .toolbar select,#app .monthly-action-bar,#app #monthly-sheet,#app .sheet-table td,#app .daily-calendar,#app .daily-day,#app .daily-grid td,#app .daily-confirm-bar,#app .daily-source-actions'))
      .filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(); const viewportPosition = ['fixed', 'sticky'].includes(getComputedStyle(node).position); return [r.x + (viewportPosition ? 0 : scrollX), r.y + (viewportPosition ? 0 : scrollY), r.width, r.height]; }),
    width: innerWidth, scroll: document.documentElement.scrollWidth,
    stage: document.querySelector('#monthly-sheet .report-fit-stage')?.getBoundingClientRect().width,
    states: Array.from(document.querySelectorAll('#app .voucher-status')).filter(node => node.getClientRects().length).map(node => [node.textContent, getComputedStyle(node).backgroundColor, getComputedStyle(node).color]),
    dirty: Object.keys(state.monthlyDirty || {}).length,
  }));
  const toggle = async enabled => {
    await page.evaluate(enabled => {
      document.getElementById('operations-surface-polish').sheet.disabled = !enabled;
      window.ZysyrReportFit.apply();
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, enabled);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const compare = async label => {
    await toggle(false); const before = await snapshot();
    await toggle(true); const after = await snapshot();
    assert.equal(after.text, before.text, label + ': report content');
    assert.deepEqual(after.inputs, before.inputs, label + ': values/permissions');
    assert.deepEqual(after.buttons, before.buttons, label + ': button labels and disabled states');
    assert.deepEqual(after.states, before.states, label + ': financial status colors');
    assert.equal(after.rects.length, before.rects.length, label + ': visible fields');
    let max = 0;
    before.rects.forEach((rect, index) => rect.forEach((value, dimension) => { max = Math.max(max, Math.abs(after.rects[index][dimension] - value)); }));
    if(max>0.2)console.error(before.rects.map((r,i)=>({index:i,before:r,after:after.rects[i],delta:Math.max(...r.map((v,j)=>Math.abs(v-after.rects[i][j])))})).filter(x=>x.delta>0.2).slice(0,12));
    assert.ok(max <= 0.2, label + ': geometry delta ' + max);
    assert.ok(after.scroll <= after.width, label + ': horizontal overflow');
    assert.equal(after.dirty, before.dirty, label + ': unsaved state');
    console.log(label + ': identical data/controls/status colors, geometry delta ' + max.toFixed(3) + 'px, no page overflow');
  };
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent('设计示例门店'));
    await page.locator('#monthly-sheet .sheet-table').waitFor();
    await compare(width + ' monthly');
    const surface = await page.locator('#monthly-sheet').evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, x: node.getBoundingClientRect().x, right: innerWidth - node.getBoundingClientRect().right }));
    assert.notEqual(surface.shadow, 'none', 'table has restrained outer elevation');
    assert.ok(surface.x >= 7 && surface.right >= 7, 'outer shadow has space at both sides');
    await page.locator('#monthly-edit-toggle').click();
    const input = page.locator('input[data-monthly-cell]').first();
    await input.fill('12.50');
    assert.equal(await input.inputValue(), '12.50', 'editing retains exact cents');
    assert.ok(await page.locator('#monthly-save-cells').isVisible(), 'save remains accessible');
    await compare(width + ' monthly editing');
    assert.equal(await input.inputValue(), '12.50', 'style toggle retains unsaved edits');
    await page.evaluate(() => { clearMonthlyUnsaved(); state.monthlyEditMode = false; });
    await page.evaluate(() => showView('daily-report'));
    await page.locator('#daily-report-calendar .daily-day[data-draft-id]').first().waitFor();
    await compare(width + ' daily calendar');
    await page.locator('#daily-report-calendar .daily-day[data-draft-id]').first().click();
    await page.locator('#daily-detail-grid .daily-grid').waitFor();
    await compare(width + ' daily detail');
    assert.ok(await page.locator('#daily-detail-save-top').isVisible(), 'draft save is preserved');
    assert.ok(await page.locator('#daily-detail-confirm-top').isVisible(), 'posting control is preserved');
    assert.ok(await page.locator('#daily-detail-upload').isVisible(), 'original report upload is preserved');
  }
  assert.deepEqual(errors, [], 'no page script errors');
  assert.deepEqual(external, [], 'no external requests');
  console.log('Operations surface geometry and interaction regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
