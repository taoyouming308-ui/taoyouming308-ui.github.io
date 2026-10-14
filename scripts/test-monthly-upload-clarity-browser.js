// Actual upload UI, synthetic preview only; no request may reach production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43831';
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'monthly-upload-clarity-'));
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage(), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    return route.fulfill({ body: fs.readFileSync(file), contentType });
  });
  for (const [width, height] of [[1366, 900], [768, 1024], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent('合成测试门店'));
    await page.locator('#monthly-material-toggle:not(.hidden)').waitFor();
    const before = await page.evaluate(() => JSON.stringify(state.data.monthly_report));
    await page.locator('#monthly-material-toggle').click();
    const panel = page.locator('#monthly-materials');
    assert.equal(await panel.getByLabel('月报数据', { exact: true }).count(), 1);
    assert.equal(await panel.getByLabel('月报凭证', { exact: true }).count(), 1);
    assert.equal(await panel.locator('button[type=submit]').count(), 1, 'one deliberate submission for either/both inputs');
    assert.equal(await panel.getByRole('button', { name: '上传并保存' }).isVisible(), true);
    assert.equal(await panel.locator('details').getAttribute('open'), null, 'detailed accounting explanation is secondary');
    assert.equal(await page.locator('#monthly-material-result').isVisible(), false, 'no redundant empty result block');
    const layout = await panel.evaluate(el => {
      const cards = Array.from(el.querySelectorAll('.monthly-upload-card')).map(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      });
      return { cards, overflow: el.scrollWidth > el.clientWidth + 1,
        font: getComputedStyle(el.querySelector('label')).fontSize,
        inputOverflow: Array.from(el.querySelectorAll('input')).some(input => input.getBoundingClientRect().right > el.getBoundingClientRect().right) };
    });
    assert.equal(layout.overflow, false, width + ': no panel overflow');
    assert.equal(layout.inputOverflow, false, width + ': inputs stay inside panel');
    assert.equal(layout.font, '18px', 'clear and readable headings');
    if (width <= 700) assert.ok(layout.cards[1].y >= layout.cards[0].bottom, 'phone cards stack');
    else assert.ok(Math.abs(layout.cards[0].y - layout.cards[1].y) < 1, 'larger screens show equal aligned columns');
    await page.locator('#monthly-material-file').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'monthly-material-vouchers', 'keyboard goes to second file input');
    assert.equal(await page.locator('#monthly-material-file').getAttribute('required'), null, 'photo-only supplements remain allowed');
    assert.notEqual(await page.locator('#monthly-material-vouchers').getAttribute('multiple'), null);
    await page.setInputFiles('#monthly-material-file', { name: '合成测试月报数据.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic') });
    await page.setInputFiles('#monthly-material-vouchers', [1, 2].map(n => ({ name: '合成月报原件-' + n + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('synthetic') })));
    await page.locator('#monthly-material-toggle').click();
    await page.locator('#monthly-material-toggle').click();
    assert.equal(await page.locator('#monthly-material-file').evaluate(el => el.files[0].name), '合成测试月报数据.xlsx');
    assert.equal(await page.locator('#monthly-material-vouchers').evaluate(el => el.files.length), 2, 'closing upload panel keeps selected files');
    assert.equal(await page.evaluate(() => JSON.stringify(state.data.monthly_report)), before, 'file selection never changes financial report');
    if (width === 1366 || width === 390) await panel.screenshot({ path: path.join(shots, 'monthly-upload-' + width + '.png') });
    await panel.locator('summary').click();
    assert.match(await panel.locator('details').innerText(), /不含卡金.*不重复统计/);
    await page.evaluate(() => { document.getElementById('monthly-material-result').textContent = '上传未完成：合成超长文件名'.repeat(30); });
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'error and long filenames wrap');
  }
  await page.goto(origin + '/operations.html?preview=1&role=shareholder');
  await page.locator('#monthly-sheet .sheet-table').waitFor();
  assert.equal(await page.locator('#monthly-material-toggle').isVisible(), false, 'shareholder cannot access finance upload');
  assert.equal(await page.locator('#monthly-materials').isVisible(), false);
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(external, [], 'no external requests');
  console.log('Monthly upload clarity: labels/formats, 320/390/768/844/1366 layouts, keyboard, file persistence, unchanged report and shareholder visibility passed.');
  console.log('Synthetic screenshots: ' + shots);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
