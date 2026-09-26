#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  if (!process.env.PLAYWRIGHT_CORE_PATH) throw error;
  playwright = require(process.env.PLAYWRIGHT_CORE_PATH);
}
const { chromium } = playwright;

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});

async function verifyViewport(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(40);
  const metrics = await page.locator('#monthly-daily-performance').evaluate(panel => {
    const table = panel.querySelector('.monthly-daily-table');
    return {
      panelWidth: panel.clientWidth,
      tableWidth: table.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      tableDisplay: getComputedStyle(panel.querySelector('.monthly-daily-table-wrap')).display,
      cardDisplay: getComputedStyle(panel.querySelector('.monthly-daily-mobile-cards')).display,
      amountFont: getComputedStyle(panel.querySelector('.monthly-daily-mobile-total strong')).fontSize,
      totals: panel.querySelectorAll('.monthly-daily-mobile-total').length,
      dailyCards: panel.querySelectorAll('.monthly-daily-mobile-card').length,
      actionGap: getComputedStyle(document.querySelector('#monthly-summary-bar')).columnGap,
      actionHeight: getComputedStyle(document.querySelector('#monthly-edit-toggle')).minHeight,
      numberFont: getComputedStyle(table.querySelector('td')).fontVariantNumeric,
      voucherGap: getComputedStyle(document.querySelector('#voucher-gallery-content')).gap,
    };
  });
  assert.equal(metrics.totals, 7, `${viewport.width}x${viewport.height}: all financial totals remain visible`);
  assert.equal(metrics.dailyCards, 31, `${viewport.width}x${viewport.height}: all natural days remain available`);
  assert.ok(metrics.tableWidth <= metrics.panelWidth + 1, `${viewport.width}x${viewport.height}: full-width table does not overflow its panel`);
  if (viewport.width <= 700) {
    assert.equal(metrics.tableDisplay, 'none', `${viewport.width}x${viewport.height}: narrow screens do not force a dense eight-column grid`);
    assert.equal(metrics.cardDisplay, 'grid', `${viewport.width}x${viewport.height}: daily metrics render as readable cards`);
    assert.ok(parseFloat(metrics.amountFont) >= 13, `${viewport.width}x${viewport.height}: mobile totals stay readable`);
  } else {
    assert.notEqual(metrics.tableDisplay, 'none', `${viewport.width}x${viewport.height}: tablet/desktop use the requested table layout`);
    assert.equal(metrics.cardDisplay, 'none', `${viewport.width}x${viewport.height}: desktop avoids duplicate daily data`);
  }
  assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth + 1, `${viewport.width}x${viewport.height}: page does not require horizontal scrolling`);
  assert.equal(metrics.actionGap, viewport.width <= 560 ? '6px' : '8px', `${viewport.width}x${viewport.height}: monthly action spacing uses the shared token without changing its established size`);
  assert.equal(metrics.actionHeight, viewport.width <= 560 ? '34px' : '38px', `${viewport.width}x${viewport.height}: monthly buttons retain their established height`);
  assert.equal(metrics.numberFont, 'tabular-nums', `${viewport.width}x${viewport.height}: financial amounts keep aligned tabular digits`);
  assert.equal(metrics.voucherGap, '12px', `${viewport.width}x${viewport.height}: voucher detail spacing uses the shared token`);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/operations.html?preview=1&role=finance&store=${encodeURIComponent('向里造型')}`);
    await page.waitForSelector('#monthly-sheet .sheet-table');
    await page.evaluate(() => {
      const month = document.getElementById('month');
      if (!month.querySelector('option[value="2026-01"]')) month.insertAdjacentHTML('beforeend', '<option value="2026-01">2026年1月</option>');
      month.value = '2026-01';
      const display = state.data.monthly_report.display_data;
      state.data.monthly_report.display_data = Object.assign({}, display, {
        columns: 22,
        range: 'A1:V73',
        values: (display.values || []).map(row => row.slice(0, 22)),
        column_widths: (display.column_widths || []).slice(0, 22),
      });
      state.data.monthly_daily_performance = {
        confirmed_days: 2,
        rows: [
          { date: '2026-01-01', draft_id: 'draft-01', labor_performance: 2126, cash_performance: 2126, card_amount: 0, group_buy: 226, alipay: 1850, wechat: 50, douyin: 0, missing_fields: [] },
          { date: '2026-01-02', draft_id: 'draft-02', labor_performance: 800, cash_performance: 500, card_amount: 300, group_buy: 0, alipay: 300, wechat: 200, douyin: 100, missing_fields: [] },
        ],
      };
      renderAll();
    });
    assert.match(await page.locator('#monthly-daily-performance').textContent(), /已入账日报 2 \/ 31 天/);
    assert.match(await page.locator('#monthly-daily-performance').textContent(), /未显示不代表休息日或零收入/);

    const headers = await page.locator('.monthly-daily-table thead th').allTextContents();
    assert.deepEqual(headers, ['日期', '劳动业绩', '现金业绩', '卡金', '团购', '支付宝', '微信', '抖音']);
    assert.deepEqual(await page.locator('.monthly-daily-table tbody tr').nth(0).locator('th,td').allTextContents(),
      ['01日', '2126.00', '2126.00', '0.00', '226.00', '1850.00', '50.00', '0.00']);
    assert.deepEqual(await page.locator('.monthly-daily-table tbody tr').nth(2).locator('th,td').allTextContents(),
      ['03日', '—', '—', '—', '—', '—', '—', '—']);
    assert.deepEqual(await page.locator('.monthly-daily-table tbody tr').nth(31).locator('th,td').allTextContents(),
      ['合计', '2926.00', '2626.00', '300.00', '226.00', '2150.00', '250.00', '100.00']);
    assert.equal(await page.locator('#monthly-sheet .sheet-table').count(), 1, 'the original monthly report remains below the daily performance table');

    await page.evaluate(() => {
      state.data.monthly_daily_performance = {
        confirmed_days: 1,
        rows: [{
          date: '2026-01-01', draft_id: 'draft-01', labor_performance: 129773,
          cash_performance: 128894, card_amount: 879, group_buy: 41570,
          alipay: 66423, wechat: 22176, douyin: 683,
        }],
      };
      renderAll();
    });
    assert.match(await page.locator('#monthly-daily-performance').textContent(), /已入账日报 1 \/ 31 天/);

    const fitCalls = await page.evaluate(async () => {
      let calls = 0;
      window.ZysyrReportFit.apply = () => { calls += 1; };
      renderSheet(state.data.monthly_report.display_data, false, false);
      await Promise.resolve();
      return calls;
    });
    assert.equal(fitCalls, 1, 'monthly report rendering keeps the existing original-sheet fitting pass');

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await verifyViewport(page, viewport);
      const daily = await page.locator('#monthly-daily-performance').evaluate(panel => {
        const visible = panel.querySelector('.monthly-daily-table-wrap').getBoundingClientRect().width > 0
          ? panel.querySelector('.monthly-daily-table-wrap') : panel.querySelector('.monthly-daily-mobile-cards');
        const range = document.createRange();
        const amount = visible.querySelector('td, dd');
        range.selectNodeContents(amount);
        return { textWidth: range.getBoundingClientRect().width, cellWidth: amount.getBoundingClientRect().width,
          fontSize: parseFloat(getComputedStyle(amount).fontSize) };
      });
      assert.ok(daily.textWidth <= daily.cellWidth + 1, `${viewport.width}x${viewport.height}: visible daily amounts do not overlap their cells`);
      assert.ok(daily.fontSize >= (viewport.width <= 700 ? 12 : 12), `${viewport.width}x${viewport.height}: daily data remain at a readable CSS size`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'zysyr-v563-monthly-daily-performance-portrait.png'), fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'zysyr-v563-monthly-daily-performance-landscape.png'), fullPage: true });

    await page.evaluate(() => {
      window.__openedDailyTrace = null;
      window.__originalDailyOpen = window.openDailyReportDay;
      window.openDailyReportDay = async (date, draftId) => { window.__openedDailyTrace = { date, draftId }; };
    });
    await page.locator('.monthly-daily-table .monthly-daily-date-link').first().click();
    assert.deepEqual(await page.evaluate(() => window.__openedDailyTrace), { date: '2026-01-01', draftId: 'draft-01' },
      'clicking a confirmed date opens its exact daily report for traceability');
    await page.evaluate(async () => {
      window.openDailyReportDay = window.__originalDailyOpen;
      await showView('daily-report');
      await openDailyReportDay('2026-01-01', 'preview-draft-1');
    });
    await page.waitForSelector('#daily-report-detail:not(.hidden)');
    assert.equal(await page.locator('#view-daily-report > .daily-month-bar').isVisible(), false,
      'month operations are hidden while a single daily report is open');
    assert.equal(await page.locator('#daily-readonly-back').isVisible(), true,
      'return-to-calendar action remains available');
    await page.locator('#daily-readonly-back').click();
    assert.equal(await page.locator('#view-daily-report > .daily-month-bar').isVisible(), true,
      'month operations remain available on the calendar');
    console.log('ZYSYR monthly daily performance browser: month placement, readable table/cards, totals and trace navigation passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
