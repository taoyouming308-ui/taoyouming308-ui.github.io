const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const source = fs.readFileSync('admin.html', 'utf8');
    await page.setContent('<style>' + source.match(/<style>([\s\S]*?)<\/style>/)[1] + '</style>' + source.slice(source.indexOf('<div id="tab-care"'), source.indexOf('<div id="tab-aesthetic"')));
    await page.addStyleTag({ content: '#tab-care{display:block!important;}' });
    await page.addScriptTag({ path: 'admin-care-monthly.js' });
    await page.evaluate(() => {
      window.SUPABASE_URL = 'https://example.test'; window.SUPABASE_KEY = 'fixture';
      window.currentAdminStore = () => '自由手艺人';
      window.fetchCareProducts = async () => [];
      window.esc = text => String(text).replace(/</g, '&lt;');
      window.openCareMonthlyEditor = (store, barber) => { window.editTarget = { store, barber }; };
      window.empty = false; window.fail = false; window.urls = [];
      window.fetch = async url => {
        urls.push(url);
        if (fail) return { ok: false, status: 503 };
        const offset = new URL(url).searchParams.get('offset');
        return { ok: true, json: async () => empty || offset !== '0' ? [] : [
          { id: 1, shop_name: '自由手艺人', barber: '无名', brand: '欧拉裴', product: '1号', grams: 12 },
          { id: 2, shop_name: '自由手艺人', barber: '无名', brand: '歌薇酸性护理', product: '6A', grams: 35 },
          { id: 3, shop_name: '自由手艺人', barber: '无名', brand: '歌薇上色水', product: '水蓝色', grams: 70 }
        ] };
      };
      document.getElementById('care-month-year').innerHTML = '<option>2026</option>';
      document.getElementById('care-month-month').innerHTML = '<option>8</option>';
    });
    await page.addScriptTag({ content: source.slice(source.indexOf('var careMonthlyRequest = 0;'), source.indexOf('// ===== 护理记录明细 =====')) });
    await page.evaluate(() => loadCareMonthlyStats());
    assert.equal(await page.locator('[data-care-brand]').count(), 3);
    assert.match(await page.locator('#care-stat-tbody').innerText(), /无名\s+12\s+35\s+70/);
    await page.locator('[data-care-person]').click();
    assert.deepEqual(await page.evaluate(() => editTarget), { store: '自由手艺人', barber: '无名' });
    assert(await page.evaluate(() => urls.every(url => url.includes('record_date=gte.2026-08-01') && url.includes('record_date=lt.2026-09-01') && decodeURIComponent(url).includes('shop_name=eq.自由手艺人'))));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('#care-stat-table-wrap').evaluate(el => el.scrollWidth > el.clientWidth));
    await page.evaluate(() => { empty = true; return loadCareMonthlyStats(); });
    assert.equal(await page.locator('#care-total-grams').innerText(), '0g');
    assert.equal(await page.locator('[data-care-person]').count(), 0);
    await page.evaluate(() => { fail = true; return loadCareMonthlyStats(); });
    assert.equal(await page.locator('[data-care-brand]').count(), 0);
    assert.equal(await page.locator('#care-total-grams').innerText(), '—');
    assert.match(await page.locator('#care-stat-summary').innerText(), /加载失败/);
    console.log('care monthly browser ok: three brands, edit navigation, month/store query, mobile scroll, empty and failed reloads');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
