// Synthetic preview only: verify report bounds through device rotation and rerenders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
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
  const browser = process.env.REPORT_FIT_WEBKIT ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ isMobile: true, hasTouch: true });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/operations.html?preview=1&role=finance');
    const views = process.env.REPORT_FIT_WEBKIT ? ['monthly', 'salary-report'] : ['monthly', 'daily-report', 'salary-report', 'finance-workbench'];
    for (const view of views) {
      await page.evaluate(async view => {
        await showView(view);
        if (view === 'monthly') {
          // Realistic large confirmed values; DOM-only fixture, no finance writes.
          window.ZysyrMonthlyDailyPerformance.render({ container: document.getElementById('monthly-daily-performance'),
            month: document.getElementById('month').value, performance: { rows: [{ date: document.getElementById('month').value + '-01', draft_id: 'fit-day', labor_performance: 141369,
              cash_performance: 128894, card_amount: 879, group_buy: 41570, alipay: 66423, wechat: 22176, douyin: 683 }] } });
        }
        if (view === 'daily-report') {
          state.imports.sheet = previewDailySheetData(); renderDailySheetDetail();
          // Restored job rendering must never make the hidden batch panel visible again.
          document.getElementById('daily-recognition-job').classList.remove('hidden');
        }
      }, view);
      for (const [width, height] of [[390,844],[844,390],[932,430],[1280,589],[1024,768],[1366,1024],[1920,1080],[390,844]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(100);
        const result = await page.evaluate(() => {
          const wrappers = [...document.querySelectorAll('.sheet-scroll,.daily-grid-scroll,.archive-wrap,.salary-paper-scroll,.history-grid-wrap')]
            .filter(el => el.getClientRects().length && el.querySelector('table'));
          const dailyPanel = document.querySelector('#monthly-daily-performance');
          const dailyTableWrap = dailyPanel && dailyPanel.querySelector('.monthly-daily-table-wrap');
          const dailyCards = dailyPanel && dailyPanel.querySelector('.monthly-daily-mobile-cards');
          const salaryTable = document.querySelector('.salary-paper-scroll .salary-paper');
          const monthlyFont = selector => {
            const cell = document.querySelector('#view-monthly .sheet-table ' + selector);
            return cell ? parseFloat(getComputedStyle(cell).fontSize) : null;
          };
          const dailyAmounts = dailyPanel ? [...dailyPanel.querySelectorAll('.monthly-daily-table td, .monthly-daily-mobile-metric dd')]
            .filter(cell => cell.getClientRects().length && cell.textContent.trim() !== '—').map(cell => {
              const range = document.createRange(); range.selectNodeContents(cell);
              return { value: cell.textContent, textWidth: range.getBoundingClientRect().width, cellWidth: cell.getBoundingClientRect().width,
                font: parseFloat(getComputedStyle(cell).fontSize) };
            }) : [];
          return { count: wrappers.length, overflows: wrappers.filter(el => el.scrollWidth > el.clientWidth + 2)
            .map(el => ({ className: el.className, width: el.clientWidth, scroll: el.scrollWidth })),
            dailyTableDisplay: dailyTableWrap && getComputedStyle(dailyTableWrap).display,
            dailyCardDisplay: dailyCards && getComputedStyle(dailyCards).display,
            dailyTotals: dailyPanel && dailyPanel.querySelectorAll('.monthly-daily-mobile-total').length,
            dailyRows: dailyPanel && dailyPanel.querySelectorAll('.monthly-daily-table tbody tr').length,
            dailyDays: (() => { const [year, month] = document.getElementById('month').value.split('-').map(Number); return new Date(year, month, 0).getDate(); })(),
            dailyAmounts,
            monthlyFonts: { label: monthlyFont('td.sheet-head'), amount: monthlyFont('td.amount-cell'), dailyHead: null },
            salaryFit: salaryTable && { transform: salaryTable.style.transform, zoom: salaryTable.style.zoom,
              stageWidth: salaryTable.parentElement.clientWidth,
              wrapperWidth: salaryTable.closest('.salary-paper-scroll').clientWidth },
            hiddenProgress: getComputedStyle(document.getElementById('daily-recognition-job')).display === 'none',
            viewport: document.querySelector('meta[name=viewport]').content };
        });
        assert(result.count > 0, view + ': no visible fixture table');
        assert.deepEqual(result.overflows, [], view + ' at ' + width + 'x' + height);
        if (view === 'monthly') {
          assert.equal(result.dailyTotals, 7, 'all daily month totals remain visible');
          assert.equal(result.dailyRows, result.dailyDays + 1, 'full-month table includes every natural date and a total');
          const largeAmounts = result.dailyAmounts.filter(item => item.value === '141369.00').map(item => item.value);
          assert.deepEqual(largeAmounts, Array(width <= 700 ? 1 : 2).fill('141369.00'), 'visible daily and total amounts preserve every digit without truncation');
          assert.ok(result.dailyAmounts.every(item => item.textWidth <= item.cellWidth + 1), 'daily amounts must fit their visible cells');
          assert.ok(result.dailyAmounts.every(item => item.font >= 12), 'daily amounts must retain readable source font size');
          if (width <= 700) {
            assert.equal(result.dailyTableDisplay, 'none', 'mobile uses cards instead of shrinking the grid');
            assert.equal(result.dailyCardDisplay, 'grid', 'mobile displays all daily records as readable cards');
          } else {
            assert.notEqual(result.dailyTableDisplay, 'none', 'tablet/desktop use the monthly table');
            assert.equal(result.dailyCardDisplay, 'none', 'tablet/desktop do not duplicate the daily records');
          }
          assert.deepEqual(result.monthlyFonts, { label: 13, amount: 12, dailyHead: null }, 'original monthly source sheet font remains unchanged');
          // Computed text-size-adjust differs across browser engines. Assert
          // actual glyph bounds above and the whole-sheet scale contract here.
          assert.equal(await page.locator('.sheet-table').evaluate(table => table.style.zoom), '1', 'monthly text must avoid CSS zoom minimum-font inflation');
          if (width === 844) await page.screenshot({ path: '/tmp/zysyr-monthly-fit-' + (process.env.REPORT_FIT_WEBKIT ? 'webkit' : 'chromium') + '.png', fullPage: true });
        }
        if (view === 'salary-report') {
          assert.match(result.salaryFit.transform, /^scale\(/, 'salary sheet should use whole-table geometric scaling');
          assert.equal(result.salaryFit.zoom, '1', 'salary sheet must avoid WebKit minimum-font CSS zoom behavior');
          assert(result.salaryFit.stageWidth <= result.salaryFit.wrapperWidth + 1, 'salary sheet stage must fit within its viewport');
          if (width === 390) await page.screenshot({ path: '/tmp/zysyr-salary-fit-' + (process.env.REPORT_FIT_WEBKIT ? 'webkit' : 'chromium') + '.png', fullPage: true });
        }
        assert(result.hiddenProgress);
        assert(!/user-scalable=no|maximum-scale=1/.test(result.viewport), 'native pinch zoom must remain available');
        if (view === 'daily-report' && width === 844) await page.screenshot({ path: '/tmp/zysyr-report-fit-phone-landscape.png', fullPage: true });
      }
      if (view === 'salary-report') {
        await page.locator('.salary-paper input').first().click();
        assert.equal(await page.locator('.salary-paper input').first().evaluate(el => document.activeElement === el), true,
          'transformed salary inputs must remain interactive');
      }
    }
    console.log('Report fit (' + (process.env.REPORT_FIT_WEBKIT ? 'WebKit monthly/salary' : 'Chromium monthly/daily/salary/petty') + '): phone, rotated phone, iPad and desktop; full amounts do not overlap; browser zoom enabled.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
