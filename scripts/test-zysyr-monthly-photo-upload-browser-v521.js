#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
assert.doesNotMatch(pageSource, /id="monthly-material-file"[^>]*\brequired\b/, 'monthly Excel input must not block photo-only supplements');
assert.match(pageSource, /history_monthly_attachment_upload/, 'historical monthly attachment route is missing');

const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});

const photo = {
  name: '一月份月报照片.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=', 'base64'),
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/operations.html?preview=1&role=finance&store=${encodeURIComponent('向里造型')}`);
    await page.waitForSelector('#monthly-material-toggle:not(.hidden)');
    await page.evaluate(() => {
      const month = document.getElementById('month');
      if (!month.querySelector('option[value="2026-01"]')) month.insertAdjacentHTML('beforeend', '<option value="2026-01">2026年1月</option>');
      month.value = '2026-01';
      state.data.monthly_report = {
        id: '11111111-1111-4111-8111-111111111111', historical: true, report_type: 'monthly_profit_loss',
        report_date: '2026-01-01', version: 1, original_filename: '历史月报.xlsx', uploaded_at: '2026-09-04T08:58:00Z',
        uploaded_by: { display_name: '财务' }, display_data: previewFilledMonthly(),
        vouchers: [{ id: '22222222-2222-4222-8222-222222222222', original_filename: '已有照片.jpg' }],
      };
      state.data.trace_summary = {};
      window.fixtureCalls = [];
      api = async (operation, payload) => {
        window.fixtureCalls.push({ operation, ...payload });
        if (operation !== 'history_monthly_attachment_upload') throw Error('Unexpected operation: ' + operation);
        state.data.monthly_report.vouchers.push({ id: '33333333-3333-4333-8333-333333333333', original_filename: payload.filename });
        return { saved: { id: '33333333-3333-4333-8333-333333333333' }, formal_ledger_amount_changed: false };
      };
      loadOverview = async () => { renderAll(); renderMonthlyAuditControls(); };
      renderAll();
      renderMonthlyAuditControls();
    });
    await page.locator('#monthly-material-toggle').click();
    await page.selectOption('#monthly-material-type', 'monthly_profit_loss');
    await page.setInputFiles('#monthly-material-vouchers', photo);
    assert.equal(await page.locator('#monthly-material-file').getAttribute('required'), null);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('monthly-material-result').textContent.includes('已补充照片 / PDF 1 份'));
    const calls = await page.evaluate(() => window.fixtureCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'history_monthly_attachment_upload');
    assert.equal(calls[0].report_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(calls[0].month, '2026-01');
    assert.equal(calls[0].filename, '一月份月报照片.jpg');
    assert.equal(await page.locator('[data-open-history-file]').count(), 2, 'new photo must appear beside the existing monthly evidence');
    assert.match(await page.locator('#monthly-material-result').innerText(), /月报金额未改变/);

    await page.evaluate(() => { state.data.monthly_report = null; renderAll(); });
    await page.selectOption('#monthly-material-type', 'monthly_profit_loss');
    await page.setInputFiles('#monthly-material-vouchers', photo);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('本月还没有月报'));
    assert.equal((await page.evaluate(() => window.fixtureCalls)).length, 1, 'photo-only upload must not create an unscoped report');

    console.log('monthly photo upload v521 browser: no native required block, completed-history binding, visible evidence and no-source guard passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
