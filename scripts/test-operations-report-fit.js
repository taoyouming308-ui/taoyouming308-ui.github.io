// Synthetic preview only: verify report bounds through device rotation and rerenders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => { if (err) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/operations.html?preview=1&role=finance');
    for (const view of ['monthly', 'daily-report', 'salary-report', 'finance-workbench']) {
      await page.evaluate(async view => {
        await showView(view);
        if (view === 'daily-report') {
          state.imports.sheet = previewDailySheetData(); renderDailySheetDetail();
          // Restored job rendering must never make the hidden batch panel visible again.
          document.getElementById('daily-recognition-job').classList.remove('hidden');
        }
      }, view);
      for (const [width, height] of [[390,844],[844,390],[1024,768],[1366,1024],[1920,1080]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(100);
        const result = await page.evaluate(() => {
          const wrappers = [...document.querySelectorAll('.sheet-scroll,.daily-grid-scroll,.archive-wrap,.salary-paper-scroll,.history-grid-wrap')]
            .filter(el => el.getClientRects().length && el.querySelector('table'));
          return { count: wrappers.length, overflows: wrappers.filter(el => el.scrollWidth > el.clientWidth + 2)
            .map(el => ({ className: el.className, width: el.clientWidth, scroll: el.scrollWidth })),
            hiddenProgress: getComputedStyle(document.getElementById('daily-recognition-job')).display === 'none',
            viewport: document.querySelector('meta[name=viewport]').content };
        });
        assert(result.count > 0, view + ': no visible fixture table');
        assert.deepEqual(result.overflows, [], view + ' at ' + width + 'x' + height);
        assert(result.hiddenProgress);
        assert(!/user-scalable=no|maximum-scale=1/.test(result.viewport), 'native pinch zoom must remain available');
        if (view === 'daily-report' && width === 844) await page.screenshot({ path: '/tmp/zysyr-report-fit-phone-landscape.png', fullPage: true });
      }
    }
    console.log('Report fit: monthly/daily/salary/petty tables fit phone, rotated phone, iPad and desktop; progress hidden; browser zoom enabled.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
