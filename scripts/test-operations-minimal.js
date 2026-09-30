// Presentation regression with synthetic local fixtures. Never contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43817';
const engine = process.env.REPORT_UI_WEBKIT ? 'webkit' : 'chromium';
const html = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
assert.match(html, /id="operations-minimal-system"/);
assert.match(html, /ZysyrMonthlyDailyPerformance\.renderIntoSheet/);
assert.doesNotMatch(html, /id="monthly-daily-performance"/);

(async () => {
  const browser = await (engine === 'webkit' ? webkit.launch({headless:true}) : chromium.launch({channel:'chrome',headless:true}));
  const errors = [], external = [];
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream'});
    });
    const bounded = async label => {
      const metrics = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed').slice(0,12).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right}))}));
      if(metrics.scroll>metrics.width+1) { await page.screenshot({path:'/tmp/operations-minimal-overflow-'+engine+'.png'}); console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('.field')).filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+2&&e.getBoundingClientRect().height).map(e=>({html:e.innerHTML,client:e.clientWidth,scroll:e.scrollWidth,children:Array.from(e.children).map(c=>({tag:c.tagName,width:c.clientWidth,scroll:c.scrollWidth,rect:c.getBoundingClientRect().toJSON()}))})))); }
      assert.ok(metrics.scroll <= metrics.width + 1, engine + ' ' + label + ' page overflow: ' + JSON.stringify(metrics));
    };
    const screenshot = async label => {
      const width = page.viewportSize().width;
      if ([1440,390,844].includes(width)) await page.screenshot({path:'/tmp/operations-minimal-'+engine+'-'+width+'-'+label+'.png'});
    };
    // Existing login is preserved; no credentials submitted.
    await page.goto(origin + '/operations.html');
    assert.equal(await page.locator('#login-form').isVisible(),true);
    await bounded('login'); await screenshot('login');
    await page.locator('#login-to-register').click();
    assert.equal(await page.locator('#register-form').isVisible(),true);
    await page.locator('#register-to-login').click();
    for (const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[844,390]]) {
      await page.setViewportSize({width,height});
      await page.goto(origin + '/operations.html?preview=1&role=finance&store=' + encodeURIComponent('界面预览门店'));
      await page.locator('#monthly-sheet .sheet-table').waitFor();
      if (width === 1440) {
        const storeChoices = await page.evaluate(() => {
          const originalUser = state.user;
          state.user = {...originalUser, store:'向里造型', stores:['向里造型','自由手艺人']};
          showApp();
          const multiStore = {options:Array.from(document.getElementById('store-select').options, option => option.value), selected:currentStore()};
          state.user = {...originalUser, store:'向里造型', stores:['向里造型']};
          showApp();
          const singleStore = {options:Array.from(document.getElementById('store-select').options, option => option.value), selected:currentStore()};
          state.user = originalUser;
          showApp();
          return {multiStore, singleStore};
        });
        assert.deepEqual(storeChoices.multiStore, {options:['自由手艺人','向里造型'], selected:'自由手艺人'}, 'authorized multi-store accounts default to 自由手艺人 first');
        assert.deepEqual(storeChoices.singleStore, {options:['向里造型'], selected:'向里造型'}, 'single-store accounts must not gain access to another store');
      }
      assert.equal(await page.locator('.topbar').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(251, 250, 246)','report chrome uses the low-glare warm surface');
      const baseline = await page.evaluate(() => {
        const style = document.getElementById('operations-minimal-system');
        style.sheet.disabled = true;
        const result = {data:JSON.stringify(state.data),text:document.querySelector('#monthly-sheet').textContent};
        style.sheet.disabled = false;
        return result;
      });
      assert.deepEqual(await page.evaluate(()=>({data:JSON.stringify(state.data),text:document.querySelector('#monthly-sheet').textContent})),baseline,'styling changes no source data or report text');
      assert.equal(await page.locator('#view-monthly table').count(),1,'monthly sheet stays integrated');
      assert.deepEqual(await page.locator('.monthly-daily-embedded-head').allTextContents(),['日期','劳动业绩','现金业绩','卡金','团购','支付宝','微信','抖音']);
      await bounded('monthly '+width); await screenshot('monthly');
      await page.locator('#monthly-material-toggle').click();
      assert.equal(await page.locator('#monthly-material-form').isVisible(),true,'uploads stay one click away');
      await bounded('upload '+width);
      await page.locator('#monthly-material-toggle').click();
      // Open an actual source-drilldown fixture rather than a disconnected mock dialog.
      await page.evaluate(()=>openCellTrace('C3'));
      await page.locator('#view-cell-trace:not(.hidden)').waitFor();
      await bounded('trace '+width); await screenshot('trace');
      await page.evaluate(()=>closeMonthlyWorkbench());
      for (const view of ['daily-report','finance-workbench','salary-report','analysis','payroll','inventory','catalog']) {
        await page.evaluate(async view => { await showView(view); await new Promise(r=>setTimeout(r,120)); }, view);
        assert.equal(await page.locator('#view-'+view).isVisible(),true,view+' remains accessible');
        await bounded(view+' '+width);
        if(['daily-report','finance-workbench','analysis'].includes(view)) await screenshot(view);
      }
      await page.evaluate(async()=>{await showView('daily-report');state.imports.sheet=previewDailySheetData();renderDailySheetDetail();});
      assert.equal(await page.locator('#daily-report-detail .daily-source-action.upload').isVisible(),true,'daily upload remains prominent');
      await bounded('daily-sheet '+width); await screenshot('daily-sheet');
      const statuses = await page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML = '<span class="voucher-status pending">待核对</span><span class="voucher-status approved">已审核</span><span class="voucher-status rejected">未通过</span>';
        document.body.appendChild(host);
        const colors = Array.from(host.children).map(e=>getComputedStyle(e).backgroundColor);
        host.remove(); return colors;
      });
      assert.equal(new Set(statuses).size,3,'pending, approved and rejected stay visually distinct');
    }
    await page.goto(origin+'/operations.html?preview=1&role=shareholder&admin=0');
    await page.locator('#monthly-sheet .sheet-table').waitFor();
    assert.equal(await page.locator('#monthly-edit-toggle').isVisible(),false);
    assert.equal(await page.locator('#monthly-material-toggle').isVisible(),false);
    assert.equal(await page.locator('#view-monthly table').count(),1);
    await page.evaluate(()=>showView('daily-report'));
    await bounded('shareholder');
    assert.deepEqual(errors,[],'no page errors');
    assert.deepEqual(external,[],'all testing must be local synthetic data');
    console.log('Operations minimal '+engine+': five viewports, login, finance pages, source trace, unchanged report data and shareholder read-only controls passed');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
