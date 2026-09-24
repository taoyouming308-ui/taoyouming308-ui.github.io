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
  const metrics = await page.locator('#monthly-sheet').evaluate(panel => {
    const table = panel.querySelector('.sheet-table');
    const rect = table.getBoundingClientRect();
    return {
      panelWidth: panel.clientWidth,
      tableWidth: rect.width,
      tableScrollWidth: table.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      embeddedHeaders: table.querySelectorAll('.monthly-daily-embedded-head').length,
      embeddedCells: table.querySelectorAll('.monthly-daily-embedded').length,
    };
  });
  assert.equal(metrics.embeddedHeaders, 8, `${viewport.width}x${viewport.height}: exact requested columns are embedded`);
  assert.equal(metrics.embeddedCells, 8 * 33, `${viewport.width}x${viewport.height}: header, 31 days and total are embedded`);
  assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth + 1, `${viewport.width}x${viewport.height}: page does not require horizontal scrolling`);
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
    assert.match(await page.locator('#monthly-daily-completeness').textContent(), /已入账 2 \/ 31 天；另有 29 天尚无已入账日报/);
    assert.match(await page.locator('#monthly-daily-completeness').textContent(), /未显示不代表休息日或零收入/);
    assert.equal(await page.locator('.monthly-daily-details-toggle').textContent(), '清晰查看日报明细');
    await page.locator('.monthly-daily-details-toggle').click();
    assert.equal(await page.locator('.monthly-daily-details').isVisible(), true, 'the detail panel opens without leaving the monthly report');
    assert.equal(await page.locator('.monthly-daily-details select option').count(), 31, 'every natural date in the month is selectable');
    assert.equal(await page.locator('.monthly-daily-details select').inputValue(), '0', 'detail view defaults to the first confirmed date');
    assert.deepEqual(await page.locator('.monthly-daily-details-item').allTextContents(),
      ['劳动业绩2126.00', '现金业绩2126.00', '卡金0.00', '团购226.00', '支付宝1850.00', '微信50.00', '抖音0.00']);
    await page.locator('.monthly-daily-details select').selectOption('2');
    assert.match(await page.locator('.monthly-daily-details-status').textContent(), /尚无已入账日报；以下“—”表示暂无已确认数据，不代表 0 元/);
    assert.deepEqual(await page.locator('.monthly-daily-details-item strong').allTextContents(), Array(7).fill('—'),
      'an unconfirmed date shows missing values rather than fabricated zeros');
    const detailSize = await page.locator('.monthly-daily-details-item strong').first().evaluate(node => getComputedStyle(node).fontSize);
    assert.equal(detailSize, '16px', 'readable details retain normal-size numbers on mobile');

    const headers = await page.locator('#monthly-sheet .monthly-daily-embedded-head').allTextContents();
    assert.deepEqual(headers, ['日期', '劳动业绩', '现金业绩', '卡金', '团购', '支付宝', '微信', '抖音']);
    assert.deepEqual(await page.locator('#monthly-sheet .sheet-table tr').nth(2).locator('.monthly-daily-embedded').allTextContents(),
      ['01日', '2126.00', '2126.00', '0.00', '226.00', '1850.00', '50.00', '0.00']);
    assert.deepEqual(await page.locator('#monthly-sheet .sheet-table tr').nth(4).locator('.monthly-daily-embedded').allTextContents(),
      ['03日', '—', '—', '—', '—', '—', '—', '—']);
    assert.deepEqual(await page.locator('#monthly-sheet .sheet-table tr').nth(33).locator('.monthly-daily-embedded-total').allTextContents(),
      ['合计', '2926.00', '2626.00', '300.00', '226.00', '2150.00', '250.00', '100.00']);

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
    assert.match(await page.locator('#monthly-daily-completeness').textContent(), /已入账 1 \/ 31 天；另有 30 天尚无已入账日报/);

    const fitCalls = await page.evaluate(async () => {
      let calls = 0;
      window.ZysyrReportFit.apply = () => { calls += 1; };
      renderSheet(state.data.monthly_report.display_data, false, false);
      await Promise.resolve();
      return calls;
    });
    assert.equal(fitCalls, 1, 'a full monthly render should coalesce table fitting until the final embedded columns and controls are in place');

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await verifyViewport(page, viewport);
      const overlap = await page.locator('#monthly-sheet .monthly-daily-embedded').evaluateAll(cells => cells
        .filter(cell => cell.textContent.trim() && cell.textContent.trim() !== '—')
        .map(cell => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return { text: cell.textContent, textWidth: range.getBoundingClientRect().width, cellWidth: cell.getBoundingClientRect().width,
            fontSize: getComputedStyle(cell).fontSize };
        }).filter(item => item.textWidth > item.cellWidth - 2));
      assert.deepEqual(overlap, [], `${viewport.width}x${viewport.height}: monthly daily values fit their cells`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'zysyr-v526-monthly-daily-performance-portrait.png'), fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'zysyr-v526-monthly-daily-performance-landscape.png'), fullPage: true });

    await page.evaluate(async () => {
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
    console.log('ZYSYR monthly daily performance browser: large totals fit and daily detail toolbar is hidden');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
