/* Local synthetic-data browser regression; no production credentials or writes. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(bytes);
  });
});
let browser;
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { width, height } = viewport;
    const page = await browser.newPage({ viewport, isMobile: width !== 1280, hasTouch: width !== 1280 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/operations.html?preview=1&role=finance');
    await page.locator('[data-trace-cell="C3"]').first().waitFor();
    if (width > height && height <= 620) {
      assert.equal(await page.locator('body').evaluate(element => element.classList.contains('report-focus')), true, 'report view must activate landscape focus mode');
      assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).display), 'none', 'landscape report must use the full width instead of keeping the sidebar');
      assert.equal(await page.locator('.sheet-scroll').evaluate(element => element.getBoundingClientRect().height >= innerHeight - 90), true, 'landscape monthly sheet must fill the available screen height');
    }
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 900;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 700, 900);
      ctx.fillStyle = '#234035'; ctx.font = '32px sans-serif'; ctx.fillText('测试样例 · 不入账', 90, 100); ctx.fillText('原始凭证预览测试', 90, 180);
      ctx.strokeRect(70, 230, 560, 460); const image = canvas.toDataURL('image/png');
      window.fixtureCalls = []; window.fixtureMode = 'formula';
      isLocalPreview = () => false;
      api = async function (operation, payload) {
        window.fixtureCalls.push({ operation, ...payload });
        const report = state.data.monthly_report;
        const target = { id: '11111111-1111-4111-8111-111111111111', historical_ledger_entry_id: '11111111-1111-4111-8111-111111111111', cell_address: payload.cell_address, numeric_value: 30, label: '测试总收入', cell_kind: 'input' };
        if (payload.cell_address === 'C3') target.id = target.historical_ledger_entry_id = '33333333-3333-4333-8333-333333333333';
        if (operation === 'cell_trace') {
          if (window.fixtureMode === 'slow') await new Promise(resolve => setTimeout(resolve, 100));
          if (window.fixtureMode === 'missing') return { target, report, historical: true, mode: 'input', evidence: [] };
          if (payload.cell_address === 'C3') return { target, report, historical: true, mode: 'formula', precedents: [{ cell_address: 'C4', label: '组成项目甲' }, { cell_address: 'C5', label: '组成项目乙' }] };
          return { target, report, historical: true, mode: 'input', can_edit: true, can_upload_vouchers: true, can_manage_business_evidence_rules: true, business_total: 30, business_details: [{ business_type: 'history_petty_cash', business_id: '22222222-2222-4222-8222-222222222222', date: '2026-01-02', title: '单笔开支', description: '测试明细', amount: 30, evidence_policy: 'voucher_required', has_evidence: true }], evidence: [{ id: 'bundle', original_filename: '模拟凭证包.docx', trace_link_level: 'bundle_only' }, { id: 'daily', evidence_source: 'voucher_attachment', original_filename: '模拟日报.png' }] };
        }
        if (operation === 'history_evidence_images') return { filename: '模拟凭证包.docx', images: [{ filename: 'image1.png', data_url: image }, { filename: 'image2.png', data_url: image }] };
        if (operation === 'voucher_url') return { filename: '模拟日报.png', url: image };
        if (operation === 'business_evidence_rule_save' || operation === 'history_monthly_cell_save' || operation === 'history_ledger_evidence_upload') return { saved: true };
        if (operation === 'overview') return state.data;
        throw Error('Unexpected API or write attempted: ' + operation);
      };
    });
    await page.locator('[data-trace-cell="C3"]').first().click();
    await page.locator('.monthly-voucher-preview img').first().waitFor();
    assert.equal(await page.evaluate(() => {
      const button = document.getElementById('cell-trace-back'), box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, 'sticky navigation must not cover the return button');
    assert.equal(await page.locator('.monthly-voucher-preview img').count(), 3);
    assert.equal(await page.locator('.voucher-file-preview').count(), 2, 'deduplicate shared originals');
    assert.equal(await page.locator('.voucher-trace-details').getAttribute('open'), null);
    assert.match(await page.locator('.monthly-voucher-preview').innerText(), /本月整包凭证/);
    assert.doesNotMatch(await page.locator('#cell-trace-page-title').innerText(), /C3/);
    if (process.env.ZYSYR_VOUCHER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.ZYSYR_VOUCHER_SCREENSHOTS, 'zysyr-voucher-preview-' + width + 'x' + height + '.png'), fullPage: true });
    const first = page.locator('.voucher-file-preview').first();
    await first.locator('[data-step="1"]').click();
    await page.waitForFunction(() => document.querySelector('.voucher-file-preview [data-count]').textContent === '2 / 2');
    await first.locator('[data-zoom="1"]').click();
    await page.locator('dialog[open]').waitFor();
    await page.locator('dialog button').click();
    await page.locator('.voucher-trace-details > summary').click();
    assert.equal(await page.locator('.voucher-trace-details').getAttribute('open'), '');
    const calls = await page.evaluate(() => window.fixtureCalls);
    assert.equal(calls.filter(call => call.operation === 'history_evidence_images').length, 1);
    assert.equal(calls.filter(call => call.operation === 'voucher_url').length, 1);
    assert.equal(new Set(calls.map(call => call.store)).size, 1);
    // One amount page keeps amount edit, upload and per-record evidence control together.
    await page.evaluate(() => openCellTrace('C4'));
    await page.locator('.monthly-inline-editor').waitFor();
    assert.equal(await page.locator('.monthly-simple-workbench [data-rules]').isVisible(), true, 'single records must stay visible outside the advanced trace disclosure');
    assert.equal(await page.locator('.monthly-simple-workbench').evaluate(node => node.compareDocumentPosition(document.querySelector('.monthly-voucher-preview')) & Node.DOCUMENT_POSITION_FOLLOWING), 4, 'controls precede gallery');
    await page.locator('[data-simple-rule]').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.operation === 'business_evidence_rule_save'));
    const evidenceCall = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'business_evidence_rule_save'));
    assert.equal(evidenceCall.business_type, 'history_petty_cash');
    assert.equal(evidenceCall.evidence_required, false, 'the switch must waive only the selected business record');
    await page.locator('#monthly-inline-amount').fill('31');
    await page.locator('#monthly-inline-reason').fill('本地浏览器回归测试');
    await page.locator('#monthly-inline-preview-button').click();
    assert.equal(await page.locator('#monthly-inline-preview').isVisible(), true, 'amount confirmation preview must be visible before save');
    assert.match(await page.locator('#monthly-inline-preview').innerText(), /修改前[\s\S]*30\.00[\s\S]*修改后[\s\S]*31\.00[\s\S]*差额[\s\S]*\+1\.00/);
    await page.locator('#monthly-inline-save').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.operation === 'history_monthly_cell_save'));
    const amountCall = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'history_monthly_cell_save'));
    assert.equal(amountCall.after_amount, '31');
    // A selected image remains local until explicit confirmation, and cancel has no write.
    const photo = { name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=', 'base64') };
    let chooser = page.waitForEvent('filechooser');
    await page.locator('#monthly-inline-upload').click();
    await (await chooser).setFiles(photo);
    await page.locator('#monthly-photo-pending img').waitFor();
    if (process.env.ZYSYR_VOUCHER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.ZYSYR_VOUCHER_SCREENSHOTS, 'zysyr-pending-photo-' + width + 'x' + height + '.png') });
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(call => call.operation === 'history_ledger_evidence_upload').length), 0);
    await page.locator('[data-cancel-photo]').click();
    assert.equal(await page.locator('#monthly-photo-pending').count(), 0);
    chooser = page.waitForEvent('filechooser');
    await page.locator('#monthly-inline-upload').click();
    await (await chooser).setFiles(photo);
    await page.locator('[data-save-photo]').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.operation === 'history_ledger_evidence_upload'));
    const photoCall = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'history_ledger_evidence_upload'));
    assert.equal(photoCall.ledger_entry_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(photoCall.store, amountCall.store);
    // Formula root exposes editable leaves and individual evidence switches in-place.
    await page.evaluate(() => openCellTrace('C3'));
    await page.locator('[aria-label="选择组成金额"]').waitFor();
    await page.locator('#monthly-inline-amount').waitFor();
    assert.equal(await page.locator('[data-simple-rule]').count(), 1);
    assert.equal(await page.evaluate(() => state.trace.address), 'C3');
    await page.locator('#monthly-inline-amount').fill('32');
    await page.locator('#monthly-inline-preview-button').click();
    await page.locator('#monthly-inline-save').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.operation === 'history_monthly_cell_save' && call.after_amount === '32') && state.trace.address === 'C3');
    await page.locator('[aria-label="选择组成金额"]').waitFor();
    await page.locator('#monthly-inline-upload').waitFor();
    chooser = page.waitForEvent('filechooser');
    await page.locator('#monthly-inline-upload').click();
    await (await chooser).setFiles(photo);
    await page.locator('[data-save-photo]').click();
    await page.waitForFunction(() => window.fixtureCalls.filter(call => call.operation === 'history_ledger_evidence_upload').length === 2);
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(call => call.operation === 'history_ledger_evidence_upload').at(-1).ledger_entry_id), '11111111-1111-4111-8111-111111111111', 'formula upload must bind selected constituent, not root');
    await page.waitForFunction(() => !document.getElementById('monthly-photo-pending') && state.trace.address === 'C3');
    // A late response must not replace a newer selected month.
    await page.evaluate(() => { window.fixtureMode = 'slow'; openCellTrace('C3'); });
    await page.evaluate(() => { document.getElementById('month').value = '2026-02'; document.getElementById('cell-trace-body').innerHTML = '新月份占位'; });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#cell-trace-body').innerText(), '新月份占位');
    await page.evaluate(() => { window.fixtureMode = 'missing'; openCellTrace('C3'); });
    await page.getByText('当前金额没有关联可预览的原始凭证。', { exact: false }).waitFor();
    assert.equal(await page.locator('.monthly-voucher-preview img').count(), 0);
    assert.equal(await page.locator('.voucher-trace-details').getAttribute('open'), null, 'missing evidence must not force-open complex source details');
    // Missing exact pages and a broken bundle must not hide usable evidence.
    await page.evaluate(() => {
      const raw = api;
      window.fixtureMode = 'formula';
      api = async function (operation, payload) {
        if (operation === 'history_evidence_images') throw Error('模拟附件不可用');
        return raw(operation, payload);
      };
      openCellTrace('C3');
    });
    await page.getByText('这份原件暂时未能读取：', { exact: false }).waitFor();
    await page.locator('.monthly-voucher-preview img').waitFor();
    assert.equal(await page.locator('.monthly-voucher-preview img').count(), 1);
    // Latest confirmed policy: income is edited directly as a monthly-only
    // adjustment, wages/totals have no voucher UI, expenses retain it.
    await page.evaluate(() => {
      window.fixtureMode = 'formula'; window.fixtureCategory = 'income';
      const raw = api;
      api = async function (operation, payload) {
        if (operation === 'monthly_income_adjustment_save') { window.fixtureCalls.push({ operation, ...payload }); return { saved: true, source_reports_unchanged: true }; }
        const result = await raw(operation, payload);
        if (operation === 'cell_trace') {
          result.item_category = window.fixtureCategory === 'purchase_summary' && payload.cell_address !== 'C3'
            ? 'expense' : window.fixtureCategory;
          result.target.label = { income: '主营 / 美发收入', salary: '人工 / 后勤人员', total: '小计', expense: '财务费用 / 银/支/微/团手续费', purchase_summary: '产品成本 / 产品进货' }[window.fixtureCategory];
          result.can_edit = true;
          if (window.fixtureCategory === 'purchase_summary' && payload.cell_address !== 'C3') result.target.label = '产品进货 / 歌薇 / 合计';
          result.can_upload_vouchers = result.item_category === 'expense';
          result.can_manage_business_evidence_rules = result.item_category === 'expense';
          if (window.fixtureCategory === 'purchase_summary') result.purchase_components = [
            { cell_address: 'G31', label: '产品进货 / 歌薇 / 合计', numeric_value: 1280, cell_kind: 'input' },
            { cell_address: 'G35', label: '产品进货 / 杭汐 / 合计', numeric_value: 960, cell_kind: 'input' },
          ], result.purchase_unincluded_components = [{ cell_address: 'G32', label: '产品进货 / 新欧芭 / 合计', numeric_value: 128, cell_kind: 'input' }];
          result.monthly_adjustment = { base_amount: 30, adjustment_delta: 0, revision: 0 };
        }
        return result;
      };
      return openCellTrace('C3');
    });
    await page.locator('#monthly-inline-amount').waitFor();
    assert.equal(await page.locator('[aria-label="选择组成金额"]').count(), 0, 'income formula must expose direct amount editing');
    assert.equal(await page.locator('.monthly-voucher-preview,[data-simple-rule],#monthly-inline-upload').count(), 0);
    await page.locator('#monthly-inline-amount').fill('45');
    await page.locator('#monthly-inline-reason').fill('月报调整，不修改日报');
    await page.locator('#monthly-inline-preview-button').click();
    assert.match(await page.locator('#monthly-inline-delta').innerText(), /15.00/);
    if (process.env.ZYSYR_VOUCHER_SCREENSHOTS) {
      await page.locator('#toast').waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(process.env.ZYSYR_VOUCHER_SCREENSHOTS, 'zysyr-income-adjustment-' + width + 'x' + height + '.png') });
    }
    await page.locator('#monthly-inline-save').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.operation === 'monthly_income_adjustment_save'));
    const adjustment = await page.evaluate(() => window.fixtureCalls.find(call => call.operation === 'monthly_income_adjustment_save'));
    assert.equal(adjustment.after_amount, '45'); assert.equal(adjustment.expected_before, 30);
    await page.evaluate(async () => { window.fixtureCategory = 'salary'; await openCellTrace('C3'); });
    await page.locator('#monthly-inline-amount').waitFor();
    assert.equal(await page.locator('.monthly-voucher-preview,[data-simple-rule],#monthly-inline-upload').count(), 0, 'salary never requires vouchers');
    assert.doesNotMatch(await page.locator('#cell-trace-body').innerText(), /缺少凭证|尚未关联凭证/);
    await page.evaluate(async () => { window.fixtureCategory = 'total'; await openCellTrace('C3'); });
    assert.equal(await page.locator('.monthly-voucher-preview,[data-simple-rule],#monthly-inline-upload,#monthly-inline-amount').count(), 0, 'totals stay read-only and voucher-free');
    assert.doesNotMatch(await page.locator('#cell-trace-body').innerText(), /缺少凭证|尚未关联凭证/);
    await page.evaluate(async () => { window.fixtureCategory = 'income'; state.data.monthly_period_was_locked = true; await openCellTrace('C3'); });
    assert.equal(await page.locator('#monthly-inline-amount').count(), 0);
    assert.equal(await page.locator('#monthly-inline-unlock').count(), 1, 'income adjustment must respect month locks');
    await page.evaluate(async () => { state.data.monthly_period_was_locked = false; window.fixtureCategory = 'expense'; await openCellTrace('C4'); });
    await page.locator('#monthly-inline-upload').waitFor();
    assert.equal(await page.locator('[data-simple-rule]').count(), 1);
    await page.evaluate(async () => { window.fixtureCategory = 'expense'; await openCellTrace('C3'); });
    await page.locator('[data-root-voucher-upload]').waitFor();
    await page.locator('#monthly-inline-amount').waitFor();
    assert.match(await page.locator('.monthly-simple-workbench').innerText(), /这项支出的凭证[\s\S]*不必先进入组成项/);
    await page.evaluate(async () => { window.fixtureCategory = 'purchase_summary'; await openCellTrace('C3'); });
    await page.locator('.purchase-detail-row').first().waitFor();
    assert.equal(await page.locator('.purchase-detail-row').count(), 2, 'purchase summary must open the original product detail rows');
    assert.match(await page.locator('.monthly-simple-workbench').innerText(), /歌薇[\s\S]*1,280\.00[\s\S]*杭汐[\s\S]*960\.00/);
    assert.match(await page.locator('.monthly-simple-workbench').innerText(), /另有 1 项、合计 128\.00 没有被当前汇总公式计入/);
    assert.equal(await page.locator('[data-root-voucher-upload],#monthly-inline-upload,.monthly-voucher-preview').count(), 0, 'purchase summary itself must not require a voucher');
    await page.locator('.purchase-detail-row').first().click();
    await page.locator('#monthly-inline-amount').waitFor();
    assert.equal(await page.locator('#monthly-inline-preview-button').count(), 1, 'one product detail must be editable inside the monthly drawer');
    assert.equal(await page.locator('#monthly-inline-upload').count(), 1, 'one product detail keeps only its own voucher entry');
    assert.equal(await page.evaluate(() => state.trace.address), 'G31', 'product detail routing must stay on the selected product cell');
    await page.evaluate(() => {
      closeMonthlyWorkbench();state.imports.sheet=previewDailySheetData();state.imports.dirty={};state.imports.dirtyLabels={};
      document.querySelectorAll('.view').forEach(node=>node.classList.add('hidden'));document.getElementById('view-daily-report').classList.remove('hidden');state.view='daily-report';
      const sheet=state.imports.sheet;window.fixtureDailyExisting=sheet.cells.find(cell=>cell.effective_numeric!=null);window.fixtureDailyBlank=sheet.cells.find(cell=>cell.effective_numeric==null);
      sheet.cells.forEach(cell=>{if(cell.effective_numeric!=null){cell.manual_override=true;cell.corrected_numeric=cell.effective_numeric;}});
      const raw=api;api=async function(operation,payload){if(operation==='daily_sheet_recognize'){window.fixtureCalls.push({operation,...payload});var next=structuredClone(state.imports.sheet),blank=next.cells.find(cell=>cell.id===window.fixtureDailyBlank.id);blank.ocr_numeric=123;blank.ocr_text='123';blank.confidence=.6;blank.source_method='kimi_vision_candidate';next.draft.edit_revision++;return {saved:{saved_cells:1,manual_cells_preserved:1},sheet:next,cells:[{id:window.fixtureDailyExisting.id,value:999,confidence:1},{id:window.fixtureDailyBlank.id,value:123,confidence:.6}],warnings:[]};}return raw(operation,payload);};
      renderDailySheetDetail();
    });
    const originalSrc=await page.locator('#daily-detail-image').getAttribute('src');
    await page.locator('#daily-report-detail [data-turn="90"]').click();
    assert.match(await page.locator('#daily-detail-image').getAttribute('style'),/rotate\(90deg\)/);
    assert.equal(await page.locator('#daily-detail-image').getAttribute('src'),originalSrc,'rotation never rewrites original image');
    await page.locator('#daily-recognize').click();
    await page.waitForFunction(()=>document.getElementById('daily-recognition-status').textContent.includes('识别草稿已保存 1 格')).catch(async error=>{console.error(await page.locator('#daily-recognition-status').innerText());console.error(await page.locator('#toast').innerText());throw error;});
    assert.equal(await page.evaluate(()=>document.querySelector('[data-daily-cell="'+window.fixtureDailyExisting.id+'"]').value),String(await page.evaluate(()=>window.fixtureDailyExisting.effective_numeric)));
    assert.equal(await page.evaluate(()=>document.querySelector('[data-daily-cell="'+window.fixtureDailyBlank.id+'"]').value),'123');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-daily-cell="'+window.fixtureDailyBlank.id+'"]').classList.contains('recognition-candidate')),true);
    assert.equal(await page.locator('#daily-detail-reviewed').isChecked(),false);
    assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(row=>row.operation==='daily_sheet_confirm').length),0);
    assert.deepEqual(errors, []);
    console.log('voucher browser passed: ' + width + 'x' + height + ', direct images, paging, zoom, inline audit, private API routing, missing evidence, stale scope');
    await page.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });
