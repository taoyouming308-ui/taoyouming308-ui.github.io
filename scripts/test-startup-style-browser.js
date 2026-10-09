const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43857';

// Future features must not reintroduce a dependency ahead of recovery.
for (const entry of ['perm-app.html', 'frontdesk.html', 'operations.html']) {
  const html = fs.readFileSync(path.join(root, entry), 'utf8');
  const guard = html.indexOf('<script data-startup>');
  assert.ok(guard > 0, entry + ': inline startup guard exists');
  const before = html.slice(0, guard);
  assert.doesNotMatch(before, /<script\b[^>]*\bsrc\s*=/i, entry + ': no script before guard');
  for (const link of before.match(/<link\b[^>]*>/gi) || []) {
    if (/\brel=["']stylesheet["']/i.test(link)) {
      assert.match(link, /\bmedia=["'](?:print|not all)["']/i, entry + ': stylesheet must not block recovery paint');
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    for (const mode of ['delay', 'failed', 'late-failed', 'ready']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let release;
      const barrier = new Promise(resolve => { release = resolve; });
      let navigations = 0;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            assert.equal(route.request().method(), 'GET', 'startup must not submit external writes');
            return route.fulfill({ status: 503, json: { error: 'synthetic unavailable' } });
          }
          const name = url.pathname.slice(1);
          if (name === 'perm-app.html') navigations++;
          if (name === 'perm-academy.css') {
            if (mode === 'delay') await barrier;
            if (mode === 'late-failed') await new Promise(resolve => setTimeout(resolve, 600));
            if (mode.endsWith('failed')) return route.fulfill({ status: 404, body: '' }).catch(() => {});
          }
          const file = path.resolve(root, name);
          if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html'
            : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/json' }).catch(() => {});
        });
        await page.goto(origin + '/perm-app.html', { waitUntil: 'commit' });
        if (mode === 'delay') {
          await page.locator('#app-startup').waitFor({ state: 'visible' });
          // A visible DOM node alone does not prove that the screen has painted.
          await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0, {}, { timeout: 3000 });
          assert.equal(await page.evaluate(() => !!window.ZysyrStartup), true);
          await page.waitForFunction(() => document.getElementById('app-startup').dataset.phase === 'slow', {}, { timeout: 10000 });
          assert.equal(await page.locator('#app-startup-retry').isVisible(), true, 'retry painted with CSS pending');
          assert.equal(await page.locator('#home-page').evaluate(el => el.inert), true, 'partly styled app stays locked');
          assert.equal(navigations, 1, 'no automatic reload');
          release();
        }
        if (mode.endsWith('failed')) {
          await page.waitForFunction(() => document.getElementById('app-startup').dataset.phase === 'failed');
          assert.equal(await page.locator('#app-startup-retry').isVisible(), true);
          assert.equal(await page.locator('#home-page').evaluate(el => el.inert), true);
        } else {
          await page.locator('#app-startup').waitFor({ state: 'hidden' });
          assert.deepEqual(errors, []);
          assert.equal(await page.locator('#home-page').evaluate(el => el.inert), false);
          assert.equal(await page.locator('#perm-startup-style').getAttribute('media'), 'all');
        }
        assert.equal(navigations, 1, 'no automatic reload');
        console.log('employee startup stylesheet ' + mode + ' passed');
      } finally {
        release();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
