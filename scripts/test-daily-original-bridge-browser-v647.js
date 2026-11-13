// Whole production page and real scripts, isolated synthetic API/storage responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43937';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=', 'base64');
const clone = value => JSON.parse(JSON.stringify(value));
const months = { '2026-07': 26, '2026-08': 26, '2026-09': 25 };
let browser;
(async function () {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  let user, overview, template, role = 'finance', mode = 'archive', blockDisplay = false;
  const calls = [], errors = [], downloads = [];
  function archive(date) {
    return { request_id: 'archive-' + date, report_date: date, original_filename: date + '-original.png',
      mime_type: 'image/png', size_bytes: png.length, sha256: 'a'.repeat(64), review_status: 'unreviewed',
      private_url: 'https://synthetic-private.invalid/original/' + date + '/archive-' + date + '.png', url_expires_in: 300 };
  }
  function day(date) {
    return { report_date: date, draft_id: 'draft-' + date, status: 'draft', grand_total: null,
      edit_revision: 0, source: 'electronic', original_count: 0, approved_original_count: 0,
      missing_original: true, has_anomaly: false, locked: false, original_archive: { state: 'archived', count: 1 } };
  }
  function monthData(month) {
    const days = Array.from({ length: months[month] || 1 }, (_, i) => day(month + '-' + String(i + 1).padStart(2, '0')));
    if (month === '2026-07') {
      const none = day(month + '-27'); none.original_archive = { state: 'none', count: 0 }; days.push(none);
      const unknown = day(month + '-28'); unknown.original_archive = { state: 'unavailable', count: null }; days.push(unknown);
      const legacy = day(month + '-29'); delete legacy.original_archive; days.push(legacy);
    }
    return { month, permissions: { write: role === 'finance' }, locked: false, days,
      recognition: { eligible_days: 0, recognized_days: 0, pending_days: 0 } };
  }
  function sheet(date) {
    const data = clone(template);
    data.draft.id = 'draft-' + date; data.draft.report_date = date;
    data.draft.source_voucher_id = null; data.draft.status = 'draft';
    data.attachments = []; data.original_image_url = null; data.original_filename = null;
    data.original_archive = { state: 'archived', count: 1 }; data.archived_originals = [archive(date)];
    data.readonly = role !== 'finance'; data.permissions = { write: role === 'finance', upload_original: role === 'finance', void_original: role === 'finance' };
    if (mode === 'none') { data.original_archive = { state: 'none', count: 0 }; data.archived_originals = []; }
    if (mode === 'unknown') { data.original_archive = { state: 'unavailable', count: null }; data.archived_originals = []; }
    if (mode === 'legacy') { delete data.original_archive; delete data.archived_originals; }
    if (mode === 'unsigned') { data.archived_originals[0].private_url = null; data.archived_originals[0].url_unavailable = true; }
    if (mode === 'wrong-date') { data.archived_originals[0].report_date = '2026-01-01'; }
    if (mode === 'financial') { data.attachments = clone(template.attachments); data.original_image_url = template.original_image_url; }
    return data;
  }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) {
      if (blockDisplay && url.pathname.endsWith('/operations-daily-original-display.js')) return route.abort();
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    }
    if (url.hostname === 'synthetic-private.invalid') { downloads.push(url.pathname); return route.fulfill({ body: png, contentType: 'image/png' }); }
    if (url.pathname.endsWith('/functions/v1/operations-api')) {
      const payload = request.postDataJSON(); calls.push(payload);
      if (payload.operation === 'session') return route.fulfill({ json: { user: role === 'finance' ? user : { ...user, role: 'shareholder', role_label: '股东', can_import_photo_reports: false, can_read_daily_reports: true } } });
      if (payload.operation === 'overview') return route.fulfill({ json: overview });
      if (payload.operation === 'monthly_review_status') return route.fulfill({ json: { publication: null, receipt: null, history: [], finance: role === 'finance' } });
      if (payload.operation === 'monthly_review_inbox') return route.fulfill({ json: { pending: [], count: 0 } });
      if (payload.operation === 'daily_sheet_month') return route.fulfill({ json: monthData(payload.month) });
      if (payload.operation === 'daily_sheet_read') return route.fulfill({ json: sheet(payload.draft_id.slice(6)) });
      if (payload.operation === 'daily_recognition_job_read') return route.fulfill({ json: { job: null } });
      throw Error('Unexpected API operation ' + payload.operation);
    }
    return route.abort();
  });
  const page = await context.newPage({ viewport: { width: 1366, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent('自由手艺人'));
  await page.waitForFunction(() => state.user && state.data.monthly_report);
  ({ user, overview, template } = await page.evaluate(() => ({ user: state.user, overview: state.data, template: previewDailySheetData() })));
  await page.evaluate(() => localStorage.setItem('zysyr-operations-session-v1', 'synthetic-session-only'));
  await page.goto(origin + '/operations.html?v=647');
  await page.waitForFunction(() => state.monthlyOverviewReady === true);
  assert(!calls.some(c => /original_archive|monthly_source_archive/.test(c.operation)), 'startup adds no auxiliary archive API reads');
  let checked = 0;
  for (const [month, count] of Object.entries(months)) {
    await page.selectOption('#month', month);
    await page.locator('.nav [data-view="daily-report"]').click();
    await page.waitForFunction(month => state.dailyReportMonth?.month === month, month);
    const summary = await page.locator('.daily-month-summary').innerText();
    assert.match(summary, new RegExp('原图已存档 · 待核对\\s+' + count + '\\s+天'));
    if (month === '2026-07') {
      assert.match(summary, /缺少原件\s+2\s+天/); assert.match(summary, /原图状态暂不可用\s+1\s+天/);
      assert.match(await page.locator('[data-daily-day="2026-07-27"]').innerText(), /缺少原始日报/);
      assert.match(await page.locator('[data-daily-day="2026-07-28"]').innerText(), /原图状态暂不可用/);
      assert.doesNotMatch(await page.locator('[data-daily-day="2026-07-28"]').innerText(), /缺少原始日报/);
    }
    for (let i = 1; i <= count; i++) {
      const date = month + '-' + String(i).padStart(2, '0');
      const card = page.locator('[data-daily-day="' + date + '"]');
      assert.match(await card.innerText(), /原图已存档 · 待核对/); assert.doesNotMatch(await card.innerText(), /缺少原始日报/);
      await card.click(); await page.waitForFunction(date => state.imports.sheet?.draft.report_date === date && !document.getElementById('daily-report-detail').classList.contains('hidden'), date);
      assert.match(await page.locator('#daily-detail-original-alert').innerText(), /原图已存档 · 待核对/);
      assert.doesNotMatch(await page.locator('#daily-report-detail').innerText(), /缺少有效原始日报表|尚未上传当天原始日报/);
      const link = page.locator('[data-daily-archived-link]');
      assert.equal(await link.getAttribute('href'), archive(date).private_url);
      assert.match(await page.locator('#daily-detail-archived-originals').innerText(), new RegExp(date));
      assert.match(await page.locator('#daily-detail-confirm').getAttribute('data-block-reason'), /上传当天原始日报.*原件审核/, 'archive alone cannot satisfy the existing financial evidence gate');
      const finance = await page.evaluate(() => ({ draft: state.imports.sheet.draft, cells: state.imports.sheet.cells, attachments: state.imports.sheet.attachments, original_image_url: state.imports.sheet.original_image_url }));
      const expected = sheet(date);
      assert.deepEqual(finance, { draft: expected.draft, cells: expected.cells, attachments: [], original_image_url: null });
      if (month === '2026-07' && i === 1) {
        await page.locator('#daily-detail-confirm').click();
        assert.match(await page.locator('#daily-detail-note').innerText(), /原件审核/);
        assert(!calls.some(c => /daily_sheet_(confirm|save)/.test(c.operation)), 'blocked confirmation sends no financial mutation');
      }
      if (i === 1) {
        const opened = page.waitForEvent('popup'); await link.click(); const popup = await opened;
        await popup.waitForLoadState('domcontentloaded'); assert.equal(popup.url(), archive(date).private_url);
        assert.equal(await popup.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
        await popup.close();
      }
      checked++; await page.locator('#daily-readonly-back').click();
    }
  }
  assert.equal(checked, 77); assert.equal(downloads.length, 3, 'a real image opens directly for each month');
  assert.equal(await page.evaluate(() => state.dailyReportMonth.recognition.eligible_days), 0);
  async function openMode(value) {
    mode = value; await page.selectOption('#month', '2026-07'); await page.locator('#daily-report-refresh').click();
    await page.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
    await page.locator('[data-daily-day="2026-07-01"]').click();
    await page.waitForFunction(() => !document.getElementById('daily-report-detail').classList.contains('hidden'));
  }
  await openMode('unknown'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /暂不可用/);
  assert.doesNotMatch(await page.locator('#daily-report-detail').innerText(), /缺少有效原始日报表|尚未上传当天原始日报/);
  await openMode('none'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /缺少有效原始日报表/);
  await openMode('legacy'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /缺少有效原始日报表/);
  await openMode('unsigned'); assert.match(await page.locator('#daily-detail-archived-originals').innerText(), /链接暂不可用/); assert.equal(await page.locator('[data-daily-archived-link]').count(), 0);
  await openMode('wrong-date'); assert.equal(await page.locator('[data-daily-archived-link]').count(), 0); assert.doesNotMatch(await page.locator('#daily-detail-archived-originals').innerText(), /2026-01-01/);
  await openMode('financial'); assert.equal(await page.locator('[data-daily-attachment]').count(), 1); assert.equal(await page.locator('[data-daily-archived-link]').count(), 1);
  assert.deepEqual(await page.evaluate(() => state.imports.sheet.attachments), template.attachments, 'existing financial attachments stay intact');
  // The actual employee iframe path uses only its existing read operations and opens the same original.
  role = 'staff'; mode = 'archive'; calls.length = 0;
  await page.evaluate(() => localStorage.setItem('booking-session', JSON.stringify({ session_token: 'synthetic-employee-session', expires_at: '2099-01-01T00:00:00Z' })));
  await page.goto(origin + '/operations.html?entry=staff-shareholder'); await page.waitForFunction(() => state.monthlyOverviewReady === true);
  await page.selectOption('#month', '2026-07'); await page.locator('.nav [data-view="daily-report"]').click();
  await page.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
  await page.locator('[data-daily-day="2026-07-01"]').click(); await page.locator('[data-daily-archived-link]').waitFor();
  assert.equal(await page.locator('#app').isVisible(), true); assert.equal(await page.locator('#daily-detail-grid input:not([disabled]):not([readonly])').count(), 0);
  assert.equal(await page.locator('#daily-detail-confirm').isVisible(), false);
  assert(calls.every(c => c.employee_session_token === 'synthetic-employee-session' && !c.session_token));
  assert(!calls.some(c => /original_archive|monthly_source_archive|daily_recognition|save|confirm|upload/.test(c.operation)));
  blockDisplay = true; await page.reload(); await page.waitForFunction(() => state.monthlyOverviewReady === true);
  await page.selectOption('#month', '2026-07'); await page.locator('.nav [data-view="daily-report"]').click();
  await page.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
  assert.match(await page.locator('[data-daily-day="2026-07-01"]').innerText(), /原图状态暂不可用/);
  await page.locator('[data-daily-day="2026-07-01"]').click();
  await page.locator('#daily-detail-original-alert').waitFor();
  assert.match(await page.locator('#daily-detail-original-alert').innerText(), /暂不可用/);
  assert.equal(await page.locator('#app').isVisible(), true, 'failed optional display resource does not break existing financial reads');
  assert.deepEqual(errors, []);
  console.log('daily original bridge: whole-page 26/26/25 presence and 77 correct date links, 3 direct image opens, financial gates, unknown/legacy and employee read boundaries passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
