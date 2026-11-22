// Whole production page and real scripts, isolated synthetic API/storage responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43937';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAeAAAAC0AQAAAABkx8JtAAAAOklEQVR42u3LMQEAAAwCIPuX1hDbCT/pQWRZlmVZlmVZlmVZlmVZlmVZlmVZlmVZlmVZlmVZlmX5Pw+ibwhH41FZNgAAAABJRU5ErkJggg==', 'base64');
const clone = value => JSON.parse(JSON.stringify(value));
const months = { '2026-07': 26, '2026-08': 26, '2026-09': 25 };
let browser;
(async function () {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log('archive bridge browser started');
  const context = await browser.newContext();
  let user, overview, template, role = 'finance', mode = 'archive', blockDisplay = false;
  let blockSourceReview = false;
  let holdNextImage, releaseImage;
  let saved = null, signedVersion = 0, holdNextRead = false, releaseRead, readStarted;
  let voidReceipt = 'confirmed', voidReadUnavailable = false, holdVoidResponse = false, voidStarted, releaseVoid;
  const savedAngles = new Map();
  const voidedArchives = new Set();
  const postedDates = new Set();
  const calls = [], errors = [], downloads = [];
  function archive(date) {
    return { request_id: 'archive-' + date, report_date: date, original_filename: date + '-original.png',
      mime_type: 'image/png', size_bytes: png.length, sha256: 'a'.repeat(64), review_status: 'unreviewed',
      private_url: 'https://synthetic-private.invalid/original/' + date + '/archive-' + date + '.png' + (signedVersion ? '?signature=' + signedVersion : ''), url_expires_in: 300,
      display_rotation_degrees: savedAngles.has(date) ? savedAngles.get(date) : null };
  }
  function activeArchives(date) {
    const original = archive(date);
    const items = mode === 'voiding' && date === '2026-07-03'
      ? [original, { ...original, request_id: original.request_id + '-second', original_filename: date + '-second.png' }]
      : [original];
    return items.filter(item => !voidedArchives.has(item.request_id));
  }
  function archiveState(items) {
    return { state: items.length ? 'archived' : 'none', count: items.length };
  }
  function day(date) {
    return { report_date: date, draft_id: 'draft-' + date, status: postedDates.has(date) ? 'confirmed' : 'draft', grand_total: null,
      edit_revision: 0, source: 'electronic', original_count: 0, approved_original_count: 0,
      missing_original: true, has_anomaly: false, locked: false, original_archive: archiveState(activeArchives(date)) };
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
    const data = clone(saved && saved.draft.report_date === date ? saved : template);
    data.draft.id = 'draft-' + date; data.draft.report_date = date;
    data.draft.source_voucher_id = null; data.draft.status = postedDates.has(date) ? 'confirmed' : 'draft';
    data.attachments = []; data.original_image_url = null; data.original_filename = null;
    data.archived_originals = activeArchives(date); data.original_archive = archiveState(data.archived_originals);
    data.readonly = role !== 'finance'; data.permissions = { write: role === 'finance', upload_original: role === 'finance', void_original: role === 'finance' };
    if (mode === 'none') { data.original_archive = { state: 'none', count: 0 }; data.archived_originals = []; }
    if (mode === 'unknown') { data.original_archive = { state: 'unavailable', count: null }; data.archived_originals = []; }
    if (mode === 'legacy') { delete data.original_archive; delete data.archived_originals; }
    if (mode === 'unsigned') { data.archived_originals[0].private_url = null; data.archived_originals[0].url_unavailable = true; }
    if (mode === 'wrong-date') { data.archived_originals[0].report_date = '2026-01-01'; }
    if (mode === 'financial' || mode === 'financial-unknown' || mode === 'voiding') { data.attachments = clone(template.attachments); data.original_image_url = template.original_image_url; }
    if (mode === 'financial-unknown') { data.original_archive = { state: 'unavailable', count: null }; data.archived_originals = []; }
    if (voidReadUnavailable) { data.original_archive = { state: 'unavailable', count: null }; data.archived_originals = []; }
    return data;
  }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) {
      if (blockDisplay && url.pathname.endsWith('/operations-daily-original-display.js')) return route.abort();
      if (blockSourceReview && url.pathname.endsWith('/operations-report-source-review.js')) return route.abort();
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    }
    if (url.hostname === 'synthetic-private.invalid') {
      downloads.push(url.pathname);
      if (mode === 'broken-image' && url.pathname.startsWith('/original/')) return route.abort('failed');
      if (holdNextImage?.url === url.href) {
        const waiting = holdNextImage.start; holdNextImage = null;
        await new Promise(resolve => { releaseImage = resolve; waiting(); });
      }
      return route.fulfill({ body: png, contentType: 'image/png' });
    }
    if (url.pathname.endsWith('/functions/v1/operations-api')) {
      const payload = request.postDataJSON(); calls.push(payload);
      if (payload.operation === 'session') return route.fulfill({ json: { user: role === 'finance' ? user : { ...user, role: 'shareholder', role_label: '股东', can_import_photo_reports: false, can_read_daily_reports: true } } });
      if (payload.operation === 'overview') return route.fulfill({ json: overview });
      if (payload.operation === 'monthly_review_status') return route.fulfill({ json: { publication: null, receipt: null, history: [], finance: role === 'finance' } });
      if (payload.operation === 'monthly_review_inbox') return route.fulfill({ json: { pending: [], count: 0 } });
      if (payload.operation === 'daily_sheet_month') return route.fulfill({ json: monthData(payload.month) });
      if (payload.operation === 'daily_sheet_create') {
        assert.equal(payload.report_date, '2026-07-30');
        assert.equal(payload.store, '自由手艺人');
        const response = sheet(payload.report_date);
        delete response.original_archive;
        delete response.archived_originals;
        return route.fulfill({ json: response });
      }
      if (payload.operation === 'daily_sheet_read') {
        const response = sheet(payload.draft_id.slice(6));
        if (holdNextRead) { holdNextRead = false; readStarted(); await new Promise(resolve => { releaseRead = resolve; }); }
        return route.fulfill({ json: response });
      }
      if (payload.operation === 'daily_sheet_save') {
        saved = sheet(payload.draft_id.slice(6)); saved.draft.edit_revision++;
        for (const edit of payload.cells) {
          const cell = saved.cells.find(item => item.id === edit.id || item.section_code === edit.section_code && item.row_key === edit.row_key && item.column_code === edit.column_code);
          assert(cell, 'synthetic save uses an existing cell');
          cell.manual_override = true;
          if (['signature', 'unclosed_order', 'note'].includes(cell.cell_role)) cell.manual_text = edit.value;
          else cell.corrected_numeric = edit.value;
        }
        delete saved.original_archive; delete saved.archived_originals;
        return route.fulfill({ json: saved });
      }
      if (payload.operation === 'daily_original_archive_orientation_save') {
        assert.equal(role, 'finance');
        assert.match(payload.request_id, /^archive-2026-/);
        assert([0, 90, 180, 270].includes(payload.degrees));
        savedAngles.set(payload.request_id.slice(8), payload.degrees);
        return route.fulfill({ json: { changed: 1, financial_records_unchanged: true } });
      }
      if (payload.operation === 'daily_original_archive_void') {
        assert.equal(role, 'finance');
        assert.equal(payload.store, '自由手艺人');
        assert.equal(payload.request_ids.length, 1);
        assert.equal(payload.reason, '照片日期误传');
        const id = payload.request_ids[0];
        const changed = voidedArchives.has(id) ? 0 : 1;
        voidedArchives.add(id);
        if (holdVoidResponse) {
          holdVoidResponse = false;
          voidStarted();
          await new Promise(resolve => { releaseVoid = resolve; });
        }
        if (voidReceipt === 'lost') return route.abort('failed');
        return route.fulfill({ json: { action: 'void', requested: 1, changed, financial_records_unchanged: true } });
      }
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
  async function assertDayShowsOriginal(reportPage, date, mobile, create = false) {
    const apiOffset = calls.length;
    const url = archive(date).private_url;
    const startingImage = new Promise(resolve => { holdNextImage = { url, start: resolve }; });
    const imageRequest = reportPage.waitForRequest(request => request.resourceType() === 'image' && request.url() === url, { timeout: 10000 });
    await Promise.all([reportPage.locator('[data-daily-day="' + date + '"]').click(), startingImage, imageRequest]);
    try {
      await reportPage.locator('#daily-detail-grid table').waitFor();
      const image = reportPage.locator('[data-daily-archived-zoom] img');
      assert.equal(await image.getAttribute('src'), archive(date).private_url);
      assert.equal(await image.getAttribute('loading'), 'eager');
      assert.equal(await image.evaluate(node => node.naturalWidth), 0, 'the report renders even while the private image is downloading');
      const dailyCalls = calls.slice(apiOffset).filter(call => /daily_sheet_(read|create)|original_archive/.test(call.operation));
      assert.deepEqual(dailyCalls.map(call => call.operation), create ? ['daily_sheet_create', 'daily_sheet_read'] : ['daily_sheet_read']);
      assert.equal(dailyCalls.at(-1).draft_id, 'draft-' + date);
      assert(dailyCalls.every(call => call.store === '自由手艺人'));
    } finally {
      releaseImage();
    }
    await reportPage.waitForFunction(({ mobile }) => {
      const image = document.querySelector('[data-daily-archived-zoom] img');
      const preview = document.getElementById('daily-detail-archived-originals').getBoundingClientRect();
      const report = document.getElementById('daily-detail-grid').getBoundingClientRect();
      if (!image?.complete || image.naturalWidth <= 0 || !image.style.width || parseFloat(image.style.width) <= 0) return false;
      const inViewport = box => box.top < window.innerHeight && box.bottom > 0 && box.width > 0;
      return inViewport(image.getBoundingClientRect()) && inViewport(report) && (mobile
        ? preview.bottom <= report.top
        : preview.right <= report.left && Math.abs(preview.top - report.top) < 2);
    }, { mobile }, { timeout: 5000 });
    assert.equal(await reportPage.locator('dialog[open]').count(), 0, 'preview is already visible with the report');
  }
  let checked = 0;
  for (const [month, count] of Object.entries(months)) {
    console.log('archive bridge month ' + month);
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
      if (month === '2026-07' && i === 1) {
        await page.setViewportSize({ width: 1920, height: 1000 });
        await assertDayShowsOriginal(page, date, false);
        const fittedWidth = await page.locator('[data-daily-archived-zoom] img').evaluate(image => parseFloat(image.style.width));
        await page.setViewportSize({ width: 1366, height: 1000 });
        await page.waitForFunction(width => parseFloat(document.querySelector('[data-daily-archived-zoom] img').style.width) > width, fittedWidth);
      } else await card.click();
      await page.waitForFunction(date => state.imports.sheet?.draft.report_date === date && !document.getElementById('daily-report-detail').classList.contains('hidden'), date);
      assert.match(await page.locator('#daily-detail-original-alert').innerText(), /原图已存档 · 待核对/);
      assert.doesNotMatch(await page.locator('#daily-report-detail').innerText(), /缺少有效原始日报表|尚未上传当天原始日报/);
      const link = page.locator('[data-daily-archived-link]');
      assert.equal(await link.getAttribute('href'), archive(date).private_url);
      const inline = page.locator('[data-daily-archived-zoom] img');
      assert.equal(await inline.getAttribute('src'), archive(date).private_url, 'original is embedded in the electronic daily page');
      assert.match(await page.locator('#daily-detail-archived-originals').innerText(), new RegExp(date));
      assert.match(await page.locator('#daily-detail-confirm-help').innerText(), /上传 \/ 重传正确日报.*原件审核/, 'an archive-only image immediately shows the binding requirement');
      assert.equal(await page.locator('#daily-detail-confirm').isDisabled(), true, 'archive alone cannot satisfy the existing financial evidence gate');
      const finance = await page.evaluate(() => ({ draft: state.imports.sheet.draft, cells: state.imports.sheet.cells, attachments: state.imports.sheet.attachments, original_image_url: state.imports.sheet.original_image_url }));
      const expected = sheet(date);
      assert.deepEqual(finance, { draft: expected.draft, cells: expected.cells, attachments: [], original_image_url: null });
      if (month === '2026-07' && i === 1) {
        await page.evaluate(() => confirmDailyReportDetail());
        assert.match(await page.locator('#daily-detail-note').innerText(), /原件审核/);
        assert(!calls.some(c => /daily_sheet_(confirm|save)/.test(c.operation)), 'blocked confirmation sends no financial mutation');
      }
      if (i === 1) {
        if (month === '2026-07') {
          const tools = page.locator('[data-archive-rotation-tools]');
          await tools.locator('[data-right]').click();
          assert.match(await inline.evaluate(image => image.style.transform), /rotate\(90deg\)/);
          await tools.locator('[data-save]').click();
          await page.waitForFunction(() => document.querySelector('[data-archive-rotation-tools] [data-status]').textContent.includes('方向已保存'));
          assert.equal(savedAngles.get(date), 90);
          await page.locator('#daily-readonly-back').click();
          await page.locator('[data-daily-day="2026-07-01"]').click();
          await page.waitForFunction(() => !document.getElementById('daily-report-detail').classList.contains('hidden'));
          assert.match(await page.locator('[data-daily-archived-zoom] img').evaluate(image => image.style.transform), /rotate\(90deg\)/);
        }
        await page.locator('[data-daily-archived-zoom]').click();
        const viewer = page.locator('dialog[aria-label="日报原图放大查看"]');
        assert.equal(await viewer.isVisible(), true);
        const beforeZoom = await viewer.locator('[data-image]').evaluate(image => image.style.width);
        await viewer.locator('[data-zoom-in]').click();
        assert.notEqual(await viewer.locator('[data-image]').evaluate(image => image.style.width), beforeZoom);
        await viewer.locator('[data-zoom-reset]').click();
        assert.equal(await viewer.locator('[data-image]').evaluate(image => image.style.width), beforeZoom);
        await viewer.locator('[data-close]').click();
        const opened = page.waitForEvent('popup'); await link.click(); const popup = await opened;
        await popup.waitForLoadState('domcontentloaded'); assert.equal(popup.url(), archive(date).private_url);
        assert.equal(await popup.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
        await popup.close();
      }
      checked++; await page.locator('#daily-readonly-back').click();
    }
  }
  assert.equal(checked, 77); assert(downloads.length >= 3, 'inline originals and direct image links load privately');
  assert.equal(await page.evaluate(() => state.dailyReportMonth.recognition.eligible_days), 0);
  const mobilePage = await context.newPage({ viewport: { width: 390, height: 844 } });
  mobilePage.on('pageerror', error => errors.push(error.message));
  await mobilePage.goto(origin + '/operations.html?v=647');
  await mobilePage.waitForFunction(() => state.monthlyOverviewReady === true);
  await mobilePage.selectOption('#month', '2026-07');
  await mobilePage.locator('.nav [data-view="daily-report"]').click();
  await mobilePage.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
  await assertDayShowsOriginal(mobilePage, '2026-07-02', true);
  await mobilePage.locator('#daily-readonly-back').click();
  await assertDayShowsOriginal(mobilePage, '2026-07-30', true, true);
  await mobilePage.close();

  async function openMode(value) {
    mode = value; await page.selectOption('#month', '2026-07'); await page.locator('#daily-report-refresh').click();
    await page.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
    await page.locator('[data-daily-day="2026-07-01"]').click();
    await page.waitForFunction(() => !document.getElementById('daily-report-detail').classList.contains('hidden'));
  }
  // Posted originals remain accessible without repeated review reminders. No
  // accounting status, attachment audit or source review is changed by rendering.
  const beforePostedCalls = calls.length;
  postedDates.add('2026-07-01');
  await openMode('archive');
  await page.waitForFunction(() => state.dailyReportMonth?.days[0].status === 'confirmed');
  const postedCard = await page.locator('[data-daily-day="2026-07-01"]').innerText();
  assert.match(postedCard, /原图已存档/);
  assert.doesNotMatch(postedCard, /待核对|原件待审核/);
  assert.match(await page.locator('[data-daily-day="2026-07-02"]').innerText(), /原图已存档 · 待核对/);
  assert.match(await page.locator('.daily-month-summary').innerText(), /原图已存档 · 待核对\s+25\s+天/);
  assert.match(await page.locator('#daily-detail-original-alert').innerText(), /原图已存档.*已入账.*无需再次核对/s);
  const postedOriginals = page.locator('#daily-detail-archived-originals');
  assert.doesNotMatch(await postedOriginals.innerText(), /待核对|审核通过/);
  assert.equal(await postedOriginals.locator('[data-daily-archived-link]').getAttribute('href'), archive('2026-07-01').private_url);
  assert.equal(await postedOriginals.locator('[data-daily-archived-void]').count(), 1, 'finance retains independent archive management on a posted day');
  assert.deepEqual(await page.evaluate(() => ({ draft: state.imports.sheet.draft, cells: state.imports.sheet.cells,
    originals: state.imports.sheet.archived_originals })), {
    draft: sheet('2026-07-01').draft, cells: sheet('2026-07-01').cells, originals: sheet('2026-07-01').archived_originals
  });
  assert(!calls.slice(beforePostedCalls).some(c => /save|confirm|upload|approve|review_submit/.test(c.operation)));
  await openMode('financial');
  assert.deepEqual(await page.evaluate(() => state.imports.sheet.attachments), template.attachments);
  assert.doesNotMatch(await page.locator('#daily-detail-attachments').innerText(), /待财务审核/);
  postedDates.clear();
  await openMode('archive');
  await page.waitForFunction(() => state.dailyReportMonth?.days[0].status === 'draft');
  assert.match(await page.locator('#daily-detail-original-alert').innerText(), /原图已存档 · 待核对/);
  assert.match(await page.locator('.daily-month-summary').innerText(), /原图已存档 · 待核对\s+26\s+天/);
  console.log('posted original archive: reminders excluded, draft transition restored, original and audit data unchanged');
  await openMode('unknown'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /暂不可用/);
  assert.doesNotMatch(await page.locator('#daily-report-detail').innerText(), /缺少有效原始日报表|尚未上传当天原始日报/);
  await openMode('none'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /缺少有效原始日报表/);
  await openMode('legacy'); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /缺少有效原始日报表/);
  await openMode('unsigned'); assert.match(await page.locator('#daily-detail-archived-originals').innerText(), /链接暂不可用/); assert.equal(await page.locator('[data-daily-archived-link]').count(), 0);
  signedVersion++; await openMode('broken-image');
  await page.locator('[data-daily-archived-image-error]').waitFor();
  assert.equal(await page.locator('[data-daily-archived-link]').isVisible(), true, 'a failed preview keeps the original-file link reachable');
  assert.equal(await page.locator('#daily-detail-grid table').isVisible(), true);
  await openMode('wrong-date'); assert.equal(await page.locator('[data-daily-archived-link]').count(), 0); assert.doesNotMatch(await page.locator('#daily-detail-archived-originals').innerText(), /2026-01-01/);
  await openMode('financial'); assert.equal(await page.locator('[data-daily-attachment]').count(), 1); assert.equal(await page.locator('[data-daily-archived-link]').count(), 1);
  assert.deepEqual(await page.evaluate(() => state.imports.sheet.attachments), template.attachments, 'existing financial attachments stay intact');
  console.log('archive bridge save/sync cases');
  await openMode('financial-unknown');
  assert.equal(await page.locator('[data-daily-attachment]').count(), 1);
  assert.match(await page.locator('#daily-detail-original-alert').innerText(), /当前有效原始资料.*原图存档状态暂不可用/s);
  // The normal save route returns a newer financial sheet without archive fields.
  await openMode('archive');
  const editable = page.locator('#daily-detail-grid input[data-daily-cell][data-role="staff_value"]').first();
  await editable.fill('42.25');
  await page.locator('#daily-detail-save-top').click();
  await page.waitForFunction(() => document.getElementById('daily-detail-note').textContent.includes('保存成功'));
  assert.equal(await page.locator('[data-daily-archived-link]').getAttribute('href'), archive('2026-07-01').private_url);
  assert.match(await page.locator('#daily-detail-original-alert').innerText(), /原图已存档/);
  assert.equal(calls.filter(c => c.operation === 'daily_sheet_save').length, 1);
  // Advancing only the test clock exercises the existing 30-second sync guard.
  await page.evaluate(() => { const now = Date.now; window.__archiveTestClock = 0; Date.now = () => now() + window.__archiveTestClock; });
  const sync = () => page.evaluate(async () => { window.__archiveTestClock += 31000; await window.ZysyrDailyReview.sync(); });
  await editable.fill('43.75');
  const dirtyBefore = await page.evaluate(() => ({ dirty: state.imports.dirty, labels: state.imports.dirtyLabels, cells: state.imports.sheet.cells, draft: state.imports.sheet.draft }));
  signedVersion++; await sync();
  assert.equal(await page.locator('[data-daily-archived-link]').getAttribute('href'), archive('2026-07-01').private_url);
  assert.equal(await editable.inputValue(), '43.75');
  assert.deepEqual(await page.evaluate(() => ({ dirty: state.imports.dirty, labels: state.imports.dirtyLabels, cells: state.imports.sheet.cells, draft: state.imports.sheet.draft })), dirtyBefore);
  assert.doesNotMatch(await page.locator('#daily-detail-sync-status').innerText(), /后台日报已有更新/);
  mode = 'unknown'; await sync(); assert.match(await page.locator('#daily-detail-original-alert').innerText(), /暂不可用/);
  assert.equal(await page.locator('[data-daily-archived-link]').count(), 0);
  mode = 'archive'; signedVersion++; await sync(); assert.equal(await page.locator('[data-daily-archived-link]').count(), 1);
  assert.equal(await editable.inputValue(), '43.75');
  assert.equal(calls.filter(c => c.operation === 'daily_sheet_save').length, 1, 'background archive updates never save dirty amounts');
  // Stale responses after a day/store switch cannot overwrite the new display.
  await page.evaluate(() => { state.imports.dirty = {}; state.imports.dirtyLabels = {}; document.getElementById('daily-detail-reason').value = ''; renderDailySheetDetail(); });
  let started = new Promise(resolve => { readStarted = resolve; }); holdNextRead = true;
  let pending = sync(); await started;
  await page.evaluate(() => openDailyReportDay('2026-07-02', 'draft-2026-07-02'));
  releaseRead(); await pending;
  assert.equal(await page.locator('[data-daily-archived-link]').getAttribute('href'), archive('2026-07-02').private_url);
  started = new Promise(resolve => { readStarted = resolve; }); holdNextRead = true; signedVersion++;
  pending = sync(); await started;
  const beforeSwitch = await page.locator('[data-daily-archived-link]').getAttribute('href');
  const storeBefore = await page.evaluate(() => { const input = document.getElementById('store-select'); const old = input.value; input.value = '向里造型'; return old; });
  releaseRead(); await pending;
  assert.equal(await page.locator('[data-daily-archived-link]').getAttribute('href'), beforeSwitch);
  await page.evaluate(value => { document.getElementById('store-select').value = value; }, storeBefore);
  assert(!calls.some(c => c.operation === 'daily_sheet_confirm'), 'no test flow posts a report');
  saved = null; signedVersion = 0;

  console.log('archive bridge individual archive void cases');
  mode = 'voiding';
  await page.evaluate(() => openDailyReportDay('2026-07-03', 'draft-2026-07-03'));
  const archiveVoids = () => calls.filter(c => c.operation === 'daily_original_archive_void');
  const firstVoid = page.locator('[data-daily-archived-void="archive-2026-07-03"]');
  const secondVoid = page.locator('[data-daily-archived-void="archive-2026-07-03-second"]');
  await firstVoid.waitFor();
  assert.equal(await firstVoid.evaluate(button => button.previousElementSibling.textContent), '另开原图');
  page.once('dialog', dialog => dialog.dismiss());
  await firstVoid.click();
  assert.equal(archiveVoids().length, 0, 'cancelling the reason prompt sends no write');
  async function clickVoid(button) {
    const handle = async dialog => {
      if (dialog.type() === 'prompt') await dialog.accept('照片日期误传');
      else await dialog.accept();
    };
    page.on('dialog', handle);
    try { await button.click(); }
    finally { page.off('dialog', handle); }
  }
  await editable.fill('49.75');
  const savesBeforeVoid = calls.filter(c => c.operation === 'daily_sheet_save').length;
  await clickVoid(firstVoid);
  await firstVoid.waitFor({ state: 'detached' });
  assert.deepEqual(archiveVoids()[0].request_ids, ['archive-2026-07-03']);
  assert.equal(await secondVoid.count(), 1);
  assert.equal(await page.locator('[data-daily-attachment]').count(), 1);
  assert.equal(await editable.inputValue(), '49.75');
  assert.equal(calls.filter(c => c.operation === 'daily_sheet_save').length, savesBeforeVoid);
  voidReceipt = 'lost'; voidReadUnavailable = true;
  await clickVoid(secondVoid);
  await page.waitForFunction(() => document.querySelector('[data-daily-archived-void="archive-2026-07-03-second"]')?.textContent === '核对作废结果');
  assert.equal(archiveVoids().length, 2);
  voidReadUnavailable = false;
  await secondVoid.click();
  await secondVoid.waitFor({ state: 'detached' });
  assert.equal(archiveVoids().length, 2, 'the unconfirmed receipt is checked by reading, never by retrying the write');
  assert.equal(await page.locator('#daily-detail-archived-originals').isVisible(), false);
  assert.equal(await page.locator('[data-daily-attachment]').count(), 1);
  assert.equal(await editable.inputValue(), '49.75');
  assert.doesNotMatch(await page.locator('[data-daily-day="2026-07-03"]').innerText(), /原图已存档/);

  await page.evaluate(() => {
    state.imports.dirty = {}; state.imports.dirtyLabels = {};
    document.getElementById('daily-detail-reason').value = '';
    return openDailyReportDay('2026-07-04', 'draft-2026-07-04');
  });
  voidReceipt = 'confirmed'; holdVoidResponse = true;
  const voidInFlight = new Promise(resolve => { voidStarted = resolve; });
  await clickVoid(page.locator('[data-daily-archived-void="archive-2026-07-04"]'));
  await voidInFlight;
  await page.evaluate(() => openDailyReportDay('2026-07-02', 'draft-2026-07-02'));
  releaseVoid();
  assert.equal(await page.locator('[data-daily-archived-link]').getAttribute('href'), archive('2026-07-02').private_url);
  assert.equal(await page.locator('[data-daily-archived-void="archive-2026-07-02"]').isEnabled(), true);

  // The actual employee iframe path uses only its existing read operations and opens the same original.
  console.log('archive bridge staff cases');
  role = 'staff'; mode = 'archive'; calls.length = 0;
  await page.evaluate(() => localStorage.setItem('booking-session', JSON.stringify({ session_token: 'synthetic-employee-session', expires_at: '2099-01-01T00:00:00Z' })));
  await page.goto(origin + '/operations.html?entry=staff-shareholder'); await page.waitForFunction(() => state.monthlyOverviewReady === true);
  await page.selectOption('#month', '2026-07'); await page.locator('.nav [data-view="daily-report"]').click();
  await page.waitForFunction(() => state.dailyReportMonth?.month === '2026-07');
  await page.locator('[data-daily-day="2026-07-01"]').click(); await page.locator('[data-daily-archived-link]').waitFor();
  assert.equal(await page.locator('#app').isVisible(), true); assert.equal(await page.locator('#daily-detail-grid input:not([disabled]):not([readonly])').count(), 0);
  assert.equal(await page.locator('#daily-detail-confirm').isVisible(), false);
  assert.equal(await page.locator('[data-daily-archived-void]').count(), 0);
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
  blockSourceReview = true; await page.reload();
  await page.waitForFunction(() => document.getElementById('app-startup').dataset.phase === 'ready');
  assert.match(await page.locator('#view-monthly [data-source-display-unavailable]').innerText(), /本月来源暂不可用/);
  assert.match(await page.locator('#view-finance-workbench [data-source-display-unavailable]').innerText(), /本月来源暂不可用/);
  assert.deepEqual(errors, []);
  console.log('daily original bridge: whole-page 26/26/25 presence and 77 correct date links, 3 direct image opens, financial gates, unknown/legacy and employee read boundaries passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
