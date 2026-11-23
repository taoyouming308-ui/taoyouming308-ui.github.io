// Isolated mobile-sized browser with all requests intercepted; no real accounts/data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43857';
const user = { username: '测试发型师', store: '自由手艺人', position: '发型师' };
const engine = process.env.STARTUP_BROWSER || 'chromium';
(async () => {
  const browser = await require('playwright')[engine].launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let sessionRoute, staffReads = 0, staffReady = false, bookingReady = false, bookingReads = 0, taskReads = 0;
    const heldStaff = [], errors = [];
    await context.addInitScript(user => {
      if (!localStorage.getItem('booking-session')) localStorage.setItem('booking-session', JSON.stringify({ ...user, session_token: 'synthetic-a', loggedAt: Date.now() }));
      sessionStorage.setItem('_curPage', 'hair');
    }, user);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        if (url.pathname.endsWith('/employee-bookings-api')) {
          const body = route.request().postDataJSON();
          assert.ok(['session', 'today_bookings'].includes(body.operation), 'no business writes');
          if (body.operation === 'session') { sessionRoute = route; return; }
          bookingReads++;
          return route.fulfill(bookingReady ? { json: { rows: [{ id: 'synthetic-booking', customer_name: '合成预约客户', barber_name: user.username, date: body.date, source: 'frontdesk' }] } } : { status: 503, json: { error: '合成暂时故障' } });
        }
        if (url.pathname.endsWith('/staff-access-api')) return route.fulfill({ json: { enabled: false } });
        if (url.pathname.endsWith('/aesthetic-study')) return route.fulfill({ status: 503, json: { error: 'synthetic' } });
        assert.equal(route.request().method(), 'GET', 'no external writes');
        if (url.pathname.endsWith('/staff')) {
          staffReads++;
          if (!staffReady) { heldStaff.push(route); return; }
          return route.fulfill({ json: [{ ...user, active: true, employment_status: 'active' }, { username: '测试助理', store: user.store, position: '技师助理', active: true, employment_status: 'active' }] });
        }
        // The active new form reads its sequence counter; do not count that as a hidden task list.
        // No legacy fallback is expected against this successful synthetic server.
        if (url.pathname.endsWith('/mgj_service_records') || (url.pathname.endsWith('/hair_records') && url.searchParams.get('select') !== 'seq:record_data->seq')) taskReads++;
        return route.fulfill({ json: [] });
      }
      if (url.pathname === '/blank') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>synthetic tab</title>' });
      const file = path.resolve(root, url.pathname.slice(1));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/json' }).catch(() => {});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/perm-app.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#identity-recovery').waitFor();
    assert.equal(await page.locator('#hair-form-name').count(), 0, 'private form waits for server verification');
    const other = await context.newPage();
    await other.goto(origin + '/blank');
    await other.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('booking-session'));
      session.loggedAt += 100;
      session.expires_at = new Date(Date.now() + 86400000).toISOString();
      localStorage.setItem('booking-session', JSON.stringify(session));
    });
    await sessionRoute.fulfill({ json: { user } });
    await page.locator('#hair-form-name').waitFor();
    await page.locator('#hair-form-name').fill('保留的未提交姓名');
    await page.locator('#hair-form-phone').fill('13000000000');
    await page.waitForTimeout(750);
    assert.equal(staffReads, 1, 'barber and assistant share one scoped request');
    assert.equal(taskReads, 0, 'new analysis does not load hidden tasks');
    const staffBox = page.locator('#hair-form-tech-container');
    await staffBox.getByRole('button', { name: /重试/ }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('#hair-form-name').inputValue(), '保留的未提交姓名');
    staffReady = true;
    await staffBox.getByRole('button', { name: /重试/ }).click();
    await staffBox.getByText('测试助理', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-hair-staff-status="barber"]').textContent.includes('暂不可用'));
    assert.equal(staffReads, 2, 'timeout evicted so retry creates a new request');
    await staffBox.getByText('测试助理', { exact: true }).click();
    await page.getByRole('button', { name: '从预约选择客户', exact: true }).click();
    const picker = page.locator('#hair-booking-picker-list');
    await picker.getByRole('button', { name: /重试/ }).waitFor();
    assert.equal(await page.locator('#hair-form-name').inputValue(), '保留的未提交姓名');
    assert.equal(await page.locator('#hair-form-phone').inputValue(), '13000000000');
    bookingReady = true;
    await picker.getByRole('button', { name: /重试/ }).click();
    await picker.getByText('合成预约客户', { exact: true }).waitFor();
    assert.equal(bookingReads, 2);
    assert.equal(await staffBox.locator('.chip.active').innerText(), '测试助理');
    assert.deepEqual(errors, []);
    if (process.env.PERF_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.PERF_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PERF_SCREENSHOT_DIR, engine + '-picker-recovered.png') });
      await page.locator('#hair-booking-picker-modal').getByRole('button', { name: '取消', exact: true }).click();
      await page.screenshot({ path: path.join(process.env.PERF_SCREENSHOT_DIR, engine + '-form-recovered.png') });
    }
    console.log(JSON.stringify({ engine, viewport: '390x844', sameTokenMetadataRecovery: true, staffReads, bookingReads, hiddenTaskReads: taskReads, unsavedFieldsPreserved: true, realCustomerData: false, physicalIPhone: false }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
