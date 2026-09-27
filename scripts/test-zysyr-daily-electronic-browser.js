const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const source = fs.readFileSync('operations-daily-electronic.js', 'utf8');
let browser;
(async () => {
  browser = await chromium.launch({ ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}), headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<main><div id="daily-detail-grid"><input id="original-amount" value="123.45"></div></main>');
    await page.evaluate(() => {
      window.state = { user: { role: 'finance' }, imports: { sheet: { draft: { id: 'draft1', report_date: '2026-01-01', status: 'confirmed' } } } };
      window.selectedStore = 'store1'; window.currentStore = () => window.selectedStore;
      window.renderDailySheetDetail = () => {};
      window.apiCalls = []; window.nextReply = { items: [], stage: 'source_only', formal_ledger_amount_changed: false };
      window.api = async (operation, payload) => { window.apiCalls.push({ operation, payload });
        if (window.holdReply) return new Promise(resolve => { window.releaseReply = resolve; }); return window.nextReply; };
    });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => renderDailySheetDetail());
    assert.equal(await page.evaluate(() => apiCalls.length), 0, 'no Meiguanjia or cloud auto-poll');
    await page.locator('#daily-electronic-source-reference summary').click();
    await page.getByText('读取当天电子来源', { exact: true }).click();
    assert((await page.locator('#daily-electronic-source-reference').innerText()).includes('不代表营业额为零'));
    assert.equal(await page.locator('#original-amount').inputValue(), '123.45');
    await page.evaluate(() => {
      nextReply = { stage: 'source_only', formal_ledger_amount_changed: false, items: [{
        business_date: '2026-01-01', candidate_id: 'candidate1', source_sha256: 'a'.repeat(64), version: 1,
        source_scope: 'projects_daily_summary', cash_total_reference_cents: null,
        gaps: [{ code: 'employee_detail_unavailable' }],
        candidate_payload: { cells: [ { label: '<img src=x onerror=alert(1)>', value_cents: 5000 },
          { column_code: 'public_card', status: 'not_applicable', value_cents: null } ] }
      }] };
    });
    await page.getByText('读取当天电子来源', { exact: true }).click();
    assert((await page.locator('#daily-electronic-source-reference').innerText()).includes('合计参考：未取得'));
    await page.getByText('查看来源数值与版本', { exact: true }).click();
    assert((await page.locator('#daily-electronic-source-reference').innerText()).includes('50.00 元'));
    assert((await page.locator('#daily-electronic-source-reference').innerText()).includes('留空（无需填写）'));
    assert.equal(await page.locator('#daily-electronic-source-reference img').count(), 0, 'source values are text, not HTML');
    await page.evaluate(() => { holdReply = true; });
    await page.getByText('读取当天电子来源', { exact: true }).click();
    await page.evaluate(() => {
      selectedStore = 'store2'; state.imports.sheet.draft.id = 'draft2'; renderDailySheetDetail();
      releaseReply(nextReply); holdReply = false;
    });
    assert.equal(await page.locator('#daily-electronic-source-reference section').count(), 0, 'late previous-store response discarded');
    await page.evaluate(() => { state.user.role = 'shareholder'; renderDailySheetDetail(); });
    assert.equal(await page.locator('#daily-electronic-source-reference').count(), 0);
    assert.equal(await page.locator('#original-amount').inputValue(), '123.45', 'confirmed amount untouched');
    assert(await page.evaluate(() => apiCalls.every(c => c.operation === 'daily_electronic_sources')));
    await page.close();
  }
  console.log('Daily electronic browser: finance-only manual reads, blanks, source escaping, stale-store responses and original values preserved');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
