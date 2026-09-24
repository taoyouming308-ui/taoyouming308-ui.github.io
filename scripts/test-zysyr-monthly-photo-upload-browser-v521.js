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
const workbook = {
  name: '盈亏表模板2026（向里造型）.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('fixture-xlsx'),
};
const extraPhotos = ['凭证甲.jpg', '凭证乙.jpg', '凭证丙.jpg'].map(name => ({ ...photo, name }));

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
        vouchers: [{ id: '22222222-2222-4222-8222-222222222222', evidence_kind: 'voucher_bundle', original_filename: '既有整月凭证包.docx' }],
      };
      state.data.trace_summary = {};
      window.fixtureCalls = [];
      window.fixtureActiveUploads = 0;
      window.fixtureMaxActiveUploads = 0;
      api = async (operation, payload) => {
        window.fixtureCalls.push({ operation, ...payload });
        if (operation === 'history_import_file_url') return { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=', expires_in: 300, filename: '一月份月报照片.jpg' };
        if (operation === 'report_upload_auto') return {
          saved: { id: '44444444-4444-4444-8444-444444444444', historical: payload.require_monthly === true, report_type: 'monthly_profit_loss', report_date: '2026-06-01', version: 2 },
          detection: { report_type: 'monthly_profit_loss', type_label: '月报原表', month: '2026-06', report_date: '2026-06-01' },
          formal_ledger_changed: false,
        };
        if (operation !== 'history_monthly_attachment_upload') throw Error('Unexpected operation: ' + operation);
        window.fixtureActiveUploads++;
        window.fixtureMaxActiveUploads = Math.max(window.fixtureMaxActiveUploads, window.fixtureActiveUploads);
        await new Promise(resolve => setTimeout(resolve, 40));
        window.fixtureActiveUploads--;
        if (payload.filename === '凭证乙.jpg') throw Error('模拟网络超时');
        state.data.monthly_report.vouchers.push({ id: '33333333-3333-4333-8333-333333333333', evidence_kind: 'supporting_document', original_filename: payload.filename, mime_type: payload.mime_type });
        return { saved: { id: '33333333-3333-4333-8333-333333333333' }, formal_ledger_amount_changed: false };
      };
      isLocalPreview = () => false;
      loadOverview = async () => { renderAll(); renderMonthlyAuditControls(); };
      renderAll();
      renderMonthlyAuditControls();
    });
    await page.locator('#monthly-material-toggle').click();
    await page.setInputFiles('#monthly-material-vouchers', photo);
    assert.equal(await page.locator('#monthly-material-file').getAttribute('required'), null);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('monthly-material-result').textContent.includes('1 份已保存，0 份需核验'));
    await page.waitForFunction(() => document.querySelector('#report-state [data-open-history-file]')?.dataset.privatePrefetched === 'true');
    const calls = await page.evaluate(() => window.fixtureCalls);
    const uploads = calls.filter(call => call.operation === 'history_monthly_attachment_upload');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].report_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(uploads[0].month, '2026-01');
    assert.equal(uploads[0].filename, '一月份月报照片.jpg');
    assert.equal(calls.filter(call => call.operation === 'history_import_file_url').length, 1, 'monthly photo signed URL must be prefetched once');
    assert.equal(await page.locator('#report-state [data-open-report]').count(), 0, 'redundant historical source button must stay hidden');
    assert.equal(await page.locator('#report-state [data-open-history-file]').count(), 1, 'only the newly supplemented monthly photo should remain visible');
    assert.equal(await page.locator('#report-state [data-open-history-file]').innerText(), '月报照片 1');
    assert.match(await page.locator('#monthly-material-result').innerText(), /月报金额未改变/);
    await page.evaluate(() => { window.open = () => ({ opener: null, location: '', close() {} }); });
    await page.locator('#report-state [data-open-history-file]').click();
    assert.equal((await page.evaluate(() => window.fixtureCalls.filter(call => call.operation === 'history_import_file_url'))).length, 1, 'opening a prefetched photo must not request another signed URL');

    await page.setInputFiles('#monthly-material-file', workbook);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('monthly-material-result').textContent.includes('自动识别为 月报原表 · 2026-06'));
    assert.equal(await page.locator('#month').inputValue(), '2026-06');
    const automatic = await page.evaluate(() => window.fixtureCalls.filter(call => call.operation === 'report_upload_auto'));
    assert.equal(automatic.length, 1);
    assert.equal(automatic[0].store, '向里造型');
    assert.equal(automatic[0].require_monthly, false);
    assert.equal(Object.hasOwn(automatic[0], 'report_type'), false, 'browser must not supply a trusted report type');
    assert.equal(Object.hasOwn(automatic[0], 'report_date'), false, 'browser must not supply a trusted report date');

    await page.evaluate(() => {
      const month = document.getElementById('month');
      month.value = '2026-01';
      document.getElementById('report-month').value = '2026-01';
      state.data.monthly_report = null;
      renderAll();
    });
    await page.setInputFiles('#monthly-material-vouchers', photo);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('本月还没有月报'));
    assert.equal((await page.evaluate(() => window.fixtureCalls.filter(call => call.operation === 'history_monthly_attachment_upload'))).length, 1, 'photo-only upload must not create an unscoped report');

    await page.evaluate(() => {
      document.getElementById('month').value = '2026-01';
      state.data.monthly_report = { id: '11111111-1111-4111-8111-111111111111', historical: true, report_type: 'monthly_profit_loss', report_date: '2026-01-01', display_data: previewFilledMonthly(), vouchers: [] };
      window.fixtureCalls = [];
    });
    await page.setInputFiles('#monthly-material-file', workbook);
    await page.setInputFiles('#monthly-material-vouchers', extraPhotos);
    await page.locator('#monthly-material-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('monthly-material-result').textContent.includes('1 份需核验'));
    const batchCalls = await page.evaluate(() => ({ calls: window.fixtureCalls, maxActive: window.fixtureMaxActiveUploads }));
    assert.equal(batchCalls.calls.filter(call => call.operation === 'report_upload_auto').length, 1, 'the source report should be submitted exactly once');
    assert.equal(batchCalls.calls.find(call => call.operation === 'report_upload_auto').require_monthly, true);
    assert.equal(batchCalls.calls.filter(call => call.operation === 'history_monthly_attachment_upload').length, 3, 'all selected attachments must receive an individual attempt');
    assert.equal(batchCalls.maxActive, 2, 'attachments should upload with a bounded concurrency of two');
    assert.match(await page.locator('#monthly-material-result').innerText(), /凭证甲\.jpg：已保存/);
    assert.match(await page.locator('#monthly-material-result').innerText(), /凭证乙\.jpg：未确认/);
    assert.match(await page.locator('#monthly-material-result').innerText(), /刷新核验/);
    assert.equal(await page.locator('#monthly-material-file').inputValue(), '', 'a saved source report must be cleared so retry cannot create a duplicate report');

    console.log('monthly upload v549 browser: photo flow, auto routing, bounded concurrency, per-file uncertainty and duplicate-source guard passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
