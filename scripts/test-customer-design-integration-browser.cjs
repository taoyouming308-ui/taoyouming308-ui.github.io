/* Real customer-modal adapter + design module. All people, images and API data are synthetic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'perm-app.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'customer-design-archive.js'), 'utf8');
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n') + '\n' + fs.readFileSync(path.join(root, 'customer-design-archive.css'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'real modal extraction markers exist: ' + start);
  return source.slice(first, last);
}
const modal = section('window.showPlanModal = function', 'function hairRecordPersonText(rec)');
const archives = section('function parseHairArrayField(value)', 'function fetchCareRecordsByHairIds(ids)');
const profileDetail = section('window.showCustomerProfile = function', '// 色调选择');
const hairFormHelpers = section('function normalizeHairBookingDate(value)', 'function hairRecordBookingId(row)') + '\n' +
  section('function hairBookingContext(bookingId', '// ===== 烫染标记') + '\n' +
  section('function normalizeHairCustomerPhone(value)', 'function normalizeHairCloudRecord(row)');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
const keys = ['style', 'person', 'length', 'features', 'layers', 'bangs', 'curls', 'care'];
const labels = ['风格', '人物适配', '长度', '发型特点', '层次', '刘海', '卷度', '打理'];
const zoneKeys = ['bangs', 'top', 'ear_front', 'ear_back', 'middle', 'bottom'];
const zoneLabels = ['刘海区', '顶区', '耳前区', '耳后区', '中区', '底区'];
const zoneFields = ['issue', 'target', 'actions', 'check'];
const processKeys = ['care_texture', 'styling', 'style_feel', 'application', 'winding', 'rod_direction', 'curl_control', 'thinning_space', 'proposal', 'technique_layers'];
const workflow = {
  execution: Object.fromEntries(zoneKeys.map(zone => [zone, Object.fromEntries(zoneFields.map(key => [key, '合成执行-' + zone + '-' + key]))])),
  process: Object.fromEntries(processKeys.map(key => [key, '合成流程-' + key])),
  review: { achieved: '合成完成核对', pending: '合成待调整', next: '合成下次重点' }
};
const makeModel = prefix => ({ outline: prefix + '轮廓', root_flow: prefix + '毛流', steps: Object.fromEntries(keys.map(key => [key, prefix + key])) });
const reasons = Object.fromEntries(['outline', 'root_flow', ...keys].map(key => [key, '沟通调整理由-' + key]));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const photos = ['front', 'back', 'left'].map((angle, i) => ({ id: uuid(100 + i), stage: 'before', angle, bucket: 'customer-design-originals', path: 'synthetic/' + i + '.png', mime_type: 'image/png' }));
  photos.push({ id: uuid(103), stage: 'after', angle: 'front', bucket: 'customer-design-originals', path: 'synthetic/after.png', mime_type: 'image/png' });
  const version = (id, versionNo, date, booking, extra = {}) => ({ id: uuid(id), version_no: versionNo, booking_id: booking, visit_id: booking ? 'booking:' + booking : uuid(400), visit_key: booking ? 'booking:' + booking : 'manual:' + date, booking_date: date, created_at: date + 'T04:' + String(versionNo).padStart(2, '0') + ':00.000Z', status: 'confirmed', baseline: makeModel('初始-'), optimized: makeModel('优化-'), reasons, photos, source: 'manual', author: { name: '合成员工' }, shop_name: '自由手艺人', ...extra });
  return {
    versions: [version(3, 2, '2026-11-08', 900001, structuredClone(workflow)), version(2, 1, '2026-11-08', 900001), version(1, 1, '2026-09-18', 899999)],
    profiles: [{ id: 9001, phone: '13800000000', name: '合成客户', shop_name: '自由手艺人', summary_scope: 'synced_store_records', total_visits: 7, total_consumption: 381.5, last_visit_date: '2026-11-08 12:00', notes: '均消¥54 | 正常客户备注 | [ChatGPT设计档案 预约900001]不应在消费区出现的旧设计正文 https://chatgpt.com/space/page_synthetic', card_packages: [{ id: 'synthetic-package', name: '剪发280', package_name: '合成五次剪发卡', left: 4, total: 5, shop: '自由手艺人', expire_date: '2027-12-31' }], service_history: Array.from({ length: 7 }, (_, i) => ({ id: 'synthetic-bill-' + i, date: '2026-09-' + String(20 + i).padStart(2, '0'), time: '12:00', amount: i === 0 ? 0 : 63.58, items: [{ name: '合成洗剪吹' }], staff: ['合成员工'], shop: '自由手艺人', bill_no: 'TEST-' + i })) }]
  };
}

async function setup(browser, width, config = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://synthetic.invalid/storage/v1/object/sign/') ? route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }) : route.abort());
  await page.setContent('<!doctype html><html><head><style>' + styles + '</style></head><body class="plan-white-mode"><button id="appointment" onclick="showPlanModal(\'13800000000\',\'合成客户\',\'合成员工\',\'2026-11-08\',900001)">预约入口</button><button id="customer" onclick="showPlanModal(\'13800000000\',\'合成客户\')">客户档案入口</button><button id="profile" onclick="showCustomerProfile(\'synthetic\')">真正客户档案页</button><div id="profile-list">合成列表</div><div id="profile-search-box">合成搜索</div><div id="profile-detail" style="display:none;padding:10px;max-width:100%;box-sizing:border-box"></div></body></html>');
  await page.addScriptTag({ content: moduleSource + '\n' + hairFormHelpers + '\n' + modal + '\n' + archives + '\n' + profileDetail });
  await page.evaluate(({ data, config }) => {
    window.esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    window.renderAiButton = () => '<button class="ai-btn" type="button">AI分析建议</button>';
    window.renderHairRecordReadOnly = () => '';
    window.updateAiButtonsAvailability = () => {};
    window.renderCustomerHistory = () => {};
    window.AUTHENTICATED_STAFF = { session_token: 'synthetic-session-only', store: '自由手艺人' };
    window.BARBER_SPECIALTIES = {};
    window.getLocalDateStr = () => '2026-11-08';
    window._customerReadScope = config.scope || 'store';
    window.fixture = data;
    window._profileGroups = { synthetic: { name: '合成客户', phone: '13800000000', records: [], profileRows: data.profiles } };
    window.deferProfile = false;
    window.releaseProfile = null;
    window.calls = [];
    window.saved = [];
    window.failSave = false;
    window.failUpload = false;
    window.failHistory = false;
    window.activeProfile = 9001;
    window.revokeCount = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = value => { window.revokeCount++; revoke(value); };
    window.fetchCustomerProfileRows = async () => window.deferProfile ? new Promise(resolve => { window.releaseProfile = () => resolve(window.fixture.profiles); }) : window.fixture.profiles;
    const handle = async (operation, payload, transport) => {
      window.calls.push({ operation, payload: JSON.parse(JSON.stringify(payload)), transport });
      if (operation === 'customer_history') return { bookings: [] };
      if (operation === 'customer_design_history') {
        if (window.failHistory) throw new Error('synthetic history unavailable');
        const versions = window.fixture.versions;
        const current = versions.find(v => payload.booking_id ? String(v.booking_id) === String(payload.booking_id) : v.visit_key === payload.visit_key);
        return { versions, visit_key: payload.visit_key, customer_profile_id: window.activeProfile, latest_version_id: current ? current.id : null, can_write: !config.otherStore, writable: !config.otherStore, editable: !config.otherStore, read_only: !!config.otherStore, shop_name: config.otherStore ? '向里造型' : '自由手艺人', store: config.otherStore ? '向里造型' : '自由手艺人' };
      }
      if (operation === 'customer_design_photo_urls') return { assets: payload.asset_ids.map(id => ({ id, url: 'https://synthetic.invalid/storage/v1/object/sign/customer-design-originals/' + id + '.png?token=synthetic' })) };
      if (operation === 'customer_design_upload') {
        if (window.failUpload) { window.failUpload = false; throw new Error('synthetic upload failed'); }
        return { asset: { id: '00000000-0000-4000-8000-' + String(900 + window.calls.filter(c => c.operation === operation).length).padStart(12, '0'), stage: payload.stage, angle: payload.angle, mime_type: payload.mime_type, byte_size: atob(payload.data_base64).length } };
      }
      if (operation === 'customer_design_save') {
        if (window.failSave) { window.failSave = false; throw new Error('synthetic save failed'); }
        const sameVisit = window.fixture.versions.filter(v => payload.booking_id ? String(v.booking_id) === String(payload.booking_id) : !v.booking_id && v.booking_date === payload.booking_date);
        const version = { id: '00000000-0000-4000-8000-' + String(800 + window.saved.length).padStart(12, '0'), version_no: sameVisit.length + 1, previous_version_id: payload.expected_latest_version_id, booking_id: payload.booking_id, visit_id: payload.visit_id || 'manual:' + payload.booking_date, visit_key: payload.visit_key, booking_date: payload.booking_date, created_at: payload.booking_date + 'T05:00:00.000Z', baseline: payload.baseline, optimized: payload.optimized, reasons: payload.reasons, execution: payload.execution, process: payload.process, review: payload.review, status: payload.status, source: 'manual', author: { name: '合成员工' }, shop_name: '自由手艺人', photos: payload.photo_ids.map(id => { const found = window.fixture.versions.flatMap(v => v.photos || []).find(p => p.id === id); return found || { id, stage: 'after', angle: 'right', mime_type: 'image/png' }; }) };
        window.saved.push(JSON.parse(JSON.stringify(payload)));
        window.fixture.versions.unshift(version);
        return { saved: true, version, latest_version_id: version.id };
      }
      throw new Error('Unexpected operation ' + operation);
    };
    window.employeeBookingsApi = (operation, payload) => handle(operation, payload, 'read-wrapper');
    window.employeeBookingsRequest = (operation, payload) => handle(operation, payload, 'authenticated-writer');
  }, { data: fixture(), config });
  return { page, errors };
}

async function open(page, entry = 'appointment') {
  await page.click('#' + entry);
  await page.waitForFunction(() => !document.querySelector('.cda [role="status"]')?.textContent.includes('正在读取'));
  await page.locator('.cda-history .cda-visit').first().waitFor();
  await page.locator('.hair-archive-title').filter({ hasText: '消费记录' }).waitFor();
}
async function fill(page, group, key, value, zone) {
  const locator = page.locator('.cda-editor [data-group="' + group + '"][data-key="' + key + '"]' + (zone ? '[data-zone="' + zone + '"]' : ''));
  await locator.evaluate(element => { let parent = element.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } });
  await locator.fill(value);
}
async function upload(page, stage = 'after', angle = 'right') {
  await page.locator('[data-upload="stage"]').selectOption(stage);
  await page.locator('[data-upload="angle"]').selectOption(angle);
  await page.locator('[data-upload="file"]').setInputFiles({ name: 'synthetic-original.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
}
async function fit(page, width) {
  const target = await page.locator('#plan-modal').count() ? page.locator('#plan-modal .box') : page.locator('#profile-detail');
  const layout = await target.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }));
  assert(layout.scroll <= layout.client + 1 && layout.right <= width + 1, 'modal/archive fits ' + width + 'px viewport: ' + JSON.stringify(layout));
}

async function viewing(browser, width) {
  const { page, errors } = await setup(browser, width);
  try {
    await open(page);
    const latest = page.locator('.cda-visit').first().locator('.cda-version').first();
    assert.equal(await page.locator('.cda-visit').count(), 2, 'visits remain separate');
    assert.equal(await page.locator('.cda-version').count(), 2, 'each visit shows only one final design');
    assert.equal(await page.evaluate(() => window.fixture.versions.length), 3, 'all immutable revisions remain stored');
    assert(!/第\s*\d+\s*版|个保存版本/.test(await page.locator('.cda-history').innerText()), 'intermediate version numbers/counts are absent from customer view');
    await latest.locator('img[alt^="原始照片"]').nth(2).waitFor();
    assert.equal(await latest.locator('.cda-photo-group').filter({ has: page.locator('h5', { hasText: '原始照片' }) }).locator('img').count(), 3, 'front, back, side originals appear in App');
    assert.equal(await latest.locator('img[alt^="完成"]').count(), 1, 'after stage remains distinct');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.cda-version[open] img')).every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await latest.locator('.cda-eight .cda-compare').count(), 8, 'eight design steps are individually shown');
    for (const [index, label] of labels.entries()) {
      const row = latest.locator('.cda-eight .cda-compare').nth(index);
      const text = await row.innerText();
      assert(text.includes(label) && text.includes('初始-' + keys[index]) && text.includes('优化-' + keys[index]) && text.includes('沟通调整理由-' + keys[index]), 'baseline/optimization/reason shown for ' + label);
    }
    assert((await latest.locator('.cda-outline').innerText()).includes('整体轮廓'));
    assert((await latest.locator('.cda-outline').innerText()).includes('发根毛流方向'));
    assert.equal(await latest.locator('.cda-execution .cda-zone').count(), 6, 'six independent zones follow eight-step design');
    for (const [index, label] of zoneLabels.entries()) {
      const zone = latest.locator('.cda-execution .cda-zone').nth(index);
      const content = await zone.innerText();
      assert(content.includes(label), 'standard zone order includes ' + label);
      for (const field of zoneFields) assert(content.includes(workflow.execution[zoneKeys[index]][field]), 'zone retains ' + field + ' for ' + label);
    }
    assert(await latest.locator('.cda-eight').evaluate(element => !!(element.compareDocumentPosition(element.closest('.cda-version-body').querySelector('.cda-execution')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'six-zone execution is after the existing eight-step design');
    assert.equal(await latest.locator('.cda-process').getAttribute('open'), null, 'ten-process reference stays folded for onsite scanning');
    await latest.locator('.cda-process > summary').click();
    for (const key of processKeys) assert((await latest.locator('.cda-process').innerText()).includes(workflow.process[key]), 'optional process note visible: ' + key);
    assert((await latest.locator('.cda-review').innerText()).includes(workflow.review.achieved), 'completion review is direct alongside photo comparison');
    assert((await latest.locator('.cda-byline').innerText()).includes('合成员工 · 员工手动填写'));
    await latest.locator('.cda-photo-open').first().click();
    assert.equal(await page.locator('dialog.cda-viewer[open]').count(), 1, 'original photo opens enlarged');
    await page.locator('dialog.cda-viewer button').click();
    await page.locator('dialog.cda-viewer').waitFor({ state: 'detached' });
    assert.equal(await page.locator('dialog.cda-viewer').count(), 0, 'viewer cleans up');
    await page.locator('.cda-visit').nth(1).locator(':scope > summary').click();
    assert((await page.locator('.cda-visit').nth(1).innerText()).includes('2026-09-18'), 'past visit/revision is expandable');
    assert.equal(await page.locator('.cda-visit').nth(1).locator('.cda-zone').count(), 0, 'legacy eight-step-only records do not acquire invented six-zone execution');
    assert((await page.locator('.cda-visit').nth(1).locator('.cda-execution').innerText()).includes('尚未记录六区执行'));
    assert((await page.locator('.cda-visit').nth(1).locator('.cda-review').innerText()).includes('尚未记录完成复盘'));
    const body = await page.locator('.plan-customer-body').innerText();
    assert(body.includes('合成五次剪发卡') && body.includes('剩4/5次') && body.includes('2027-12-31'), 'existing package, remaining balance and expiry retained');
    assert(body.includes('¥381.5') || body.includes('¥382'), 'consumption total retained with original rendering');
    assert(body.includes('已同步 7 笔消费') && body.indexOf('2026-09-26') < body.indexOf('2026-09-25'), 'consumption history latest first');
    assert(body.includes('正常客户备注') && body.includes('均消¥54'), 'ordinary notes retained');
    assert(!body.includes('不应在消费区出现的旧设计正文') && !body.includes('page_synthetic'), 'legacy design note wall removed from consumption/profile summary');
    await page.locator('.plan-customer-body details > summary').click();
    assert((await page.locator('.plan-customer-body').innerText()).includes('TEST-0'), 'older bill detail retained');
    await fit(page, width);
    await page.locator('#plan-modal .close-btn').click();
    assert.equal(await page.locator('.cda,#plan-modal,dialog.cda-viewer').count(), 0, 'closing destroys archive module');
    await open(page);
    assert.equal(await page.locator('.cda').count(), 1, 'reopening mounts a single archive');
    assert.equal(errors.length, 0, 'no browser runtime errors: ' + errors.join(', '));
  } finally { await page.close(); }
}

async function manualSave(browser, width, entry) {
  const { page, errors } = await setup(browser, width);
  try {
    await open(page, entry);
    await page.locator('[data-action="record"]').click();
    assert.equal(await page.locator('[data-meta="booking_date"]').getAttribute('readonly'), entry === 'appointment' ? '' : null, 'booking date locked only for an actual booking');
    if (entry !== 'appointment') await page.locator('[data-meta="booking_date"]').fill('2026-11-09');
    await fill(page, 'baseline', 'outline', '人工初判：纵向椭圆');
    await fill(page, 'optimized', 'outline', '人工优化：中区收紧');
    await fill(page, 'reasons', 'outline', '顾客确认自然知性并希望轻柔');
    await fill(page, 'baseline', 'style', '自然知性');
    await fill(page, 'optimized', 'style', '自然知性增加少量柔美');
    await fill(page, 'reasons', 'style', '沟通后保留日常好打理');
    await fill(page, 'execution', 'target', '人工顶区目标：适量支撑', 'top');
    await fill(page, 'execution', 'check', '人工底区核对：肩颈比例', 'bottom');
    await fill(page, 'process', 'proposal', '人工提案：八步与六区衔接');
    await fill(page, 'review', 'achieved', '人工复盘：轮廓已核对');
    await upload(page);
    await fit(page, width);
    await page.evaluate(() => { window.failSave = true; });
    await page.locator('.cda-save-row button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.cda-draft-feedback')?.textContent.includes('synthetic save failed'));
    assert.equal(await page.locator('[data-group="baseline"][data-key="outline"]').inputValue(), '人工初判：纵向椭圆', 'failed save retains all text');
    assert.equal(await page.locator('[data-group="execution"][data-zone="top"][data-key="target"]').inputValue(), '人工顶区目标：适量支撑', 'save failure retains six-zone execution');
    assert.equal(await page.locator('[data-group="process"][data-key="proposal"]').inputValue(), '人工提案：八步与六区衔接');
    assert.equal(await page.locator('[data-group="review"][data-key="achieved"]').inputValue(), '人工复盘：轮廓已核对');
    assert.equal(await page.locator('.cda-editor img[alt^="完成"]').count(), entry === 'appointment' ? 2 : 1, 'failed save retains picked files and existing after originals');
    const firstWrite = await page.evaluate(() => window.calls.find(call => call.operation === 'customer_design_save'));
    assert.equal(firstWrite.transport, 'authenticated-writer', 'save bypasses cached/retrying read wrapper');
    assert.equal(firstWrite.payload.session_token, 'synthetic-session-only', 'session attached by real modal adapter');
    assert.equal(firstWrite.payload.customer_profile_id, 9001, 'stable resolved customer profile ID attached');
    assert.equal(firstWrite.payload.booking_id, entry === 'appointment' ? 900001 : null, 'actual booking context preserved without guessing');
    assert.equal(firstWrite.payload.visit_key, entry === 'appointment' ? 'booking:900001' : 'manual:2026-11-09', 'stable visit key accompanies every version');
    assert.equal(firstWrite.payload.customer_scope, 'store', 'writes stay in authenticated employee store');
    assert.equal(firstWrite.payload.booking_date, entry === 'appointment' ? '2026-11-08' : '2026-11-09', 'visit date preserved');
    assert.equal(firstWrite.payload.expected_latest_version_id, entry === 'appointment' ? uuid(3) : null, 'concurrency chain anchored to active visit');
    const uploadCall = await page.evaluate(() => window.calls.find(call => call.operation === 'customer_design_upload'));
    assert.equal(uploadCall.transport, 'authenticated-writer');
    assert.equal(uploadCall.payload.data_base64, PNG, 'upload preserves exact original file bytes');
    assert.equal(uploadCall.payload.stage, 'after');
    assert.equal(uploadCall.payload.angle, 'right');
    assert.equal(uploadCall.payload.booking_id, entry === 'appointment' ? 900001 : null);
    assert.equal(uploadCall.payload.visit_key, firstWrite.payload.visit_key);
    assert.equal(uploadCall.payload.session_token, 'synthetic-session-only');
    // An uncertain save never silently retries. A user re-reads before explicitly retrying.
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_save').length), 1);
    await page.locator('.cda-conflict-tools [data-action="refresh"]').click();
    await page.waitForFunction(() => window.calls.filter(call => call.operation === 'customer_design_history').length >= 2);
    assert.equal(await page.locator('[data-group="baseline"][data-key="outline"]').inputValue(), '人工初判：纵向椭圆');
    await page.locator('.cda-save-row button[type="submit"]').click();
    await page.waitForFunction(() => window.saved.length === 1 && !document.querySelector('.cda-editor'));
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_upload').length), 1, 'successful upload receipt reused after save failure');
    const saved = await page.evaluate(() => window.saved[0]);
    assert.equal(saved.request_id, firstWrite.payload.request_id, 'explicit retry keeps same idempotency request');
    assert.equal(saved.baseline.outline, '人工初判：纵向椭圆');
    assert.equal(saved.optimized.steps.style, '自然知性增加少量柔美');
    assert.equal(saved.execution.top.target, '人工顶区目标：适量支撑');
    assert.equal(saved.execution.bottom.check, '人工底区核对：肩颈比例');
    assert.equal(saved.process.proposal, '人工提案：八步与六区衔接');
    assert.equal(saved.review.achieved, '人工复盘：轮廓已核对');
    assert.deepEqual(Object.keys(saved.execution), zoneKeys, 'all six known zones have a stable stored shape');
    if (entry === 'appointment') assert.equal(saved.execution.ear_back.actions, workflow.execution.ear_back.actions, 'untouched existing execution is retained when continuing the visit');
    assert(saved.photo_ids.length === (entry === 'appointment' ? 5 : 1), 'saved new version carries its precise photos');
    assert.equal(await page.evaluate(() => window.fixture.versions.length), 4, 'new save appends rather than overwriting prior states');
    assert.equal(await page.locator('.cda-version').count(), entry === 'appointment' ? 2 : 3, 'only the final design per visit remains in the customer view');
    assert.equal(await page.locator('.cda-visit').count(), entry === 'appointment' ? 2 : 3, 'manual no-booking visit grouped distinctly');
    assert.equal(await page.evaluate(() => window.revokeCount), 1, 'local preview object URL released after save');
    assert.equal(errors.length, 0, 'no browser runtime errors: ' + errors.join(', '));
  } finally { await page.close(); }
}

async function unsavedGuard(browser) {
  const { page } = await setup(browser, 390);
  try {
    await open(page);
    await page.locator('[data-action="record"]').click();
    await fill(page, 'baseline', 'outline', '尚未保存的判断');
    await upload(page);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#plan-modal .close-btn').click();
    assert.equal(await page.locator('.cda-editor').count(), 1, 'cancelled close retains draft');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.customer-read-scope').selectOption('all');
    assert.equal(await page.locator('.customer-read-scope').inputValue(), 'store', 'cancelled scope switch restores UI and scope');
    assert.equal(await page.locator('[data-group="baseline"][data-key="outline"]').inputValue(), '尚未保存的判断');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#plan-modal .close-btn').click();
    assert.equal(await page.locator('#plan-modal,.cda-viewer').count(), 0);
    assert.equal(await page.evaluate(() => window.revokeCount), 1, 'discarding releases local photo URLs');
    await open(page, 'customer');
    assert.equal(await page.locator('.cda').count(), 1);
    assert.equal(await page.locator('.cda-editor').count(), 0, 'draft does not leak into another entry');
  } finally { await page.close(); }
}

async function scopePermission(browser, otherStore) {
  const { page } = await setup(browser, 390, { scope: 'all', otherStore });
  try {
    if (otherStore) await page.evaluate(() => {
      window.fixture.versions = window.fixture.versions.map(v => ({ ...v, shop_name: '向里造型', store: '向里造型' }));
      window.fixture.profiles[0].shop_name = '向里造型';
    });
    await open(page);
    assert.equal(await page.locator('[data-action="record"]').isDisabled(), otherStore, otherStore ? 'other-store customer remains read-only' : 'shared read scope permits own-store design entry');
    if (!otherStore) {
      await page.locator('[data-action="record"]').click();
      assert.equal(await page.locator('.cda-editor').count(), 1);
    } else {
      assert.equal(await page.evaluate(() => window.calls.filter(call => /save|upload/.test(call.operation)).length), 0, 'viewing other-store records emits no writes');
    }
  } finally { await page.close(); }
}


async function profileReturnAndRace(browser) {
  const { page } = await setup(browser, 390);
  try {
    await open(page, 'profile');
    assert.equal(await page.locator('.customer-design-profile-root .cda').count(), 1, 'actual customer detail mounts archive before consumption');
    await page.locator('[data-action="record"]').click();
    await fill(page, 'baseline', 'outline', '真实档案页未保存草稿');
    await upload(page);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
    assert.equal(await page.locator('.cda-editor').count(), 1, 'back cancellation retains profile draft');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
    assert.equal(await page.locator('#profile-detail .cda').count(), 0, 'return destroys profile module');
    assert.equal(await page.evaluate(() => window.revokeCount), 1, 'profile return releases photo URL');
    assert.equal(await page.locator('#profile-detail').isVisible(), false);
    await page.evaluate(() => { window.deferProfile = true; window.showCustomerProfile('synthetic'); window.backToProfileList(); });
    await page.waitForFunction(() => !!window.releaseProfile);
    await page.evaluate(() => window.releaseProfile());
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#profile-detail .cda').count(), 0, 'late customer response does not remount departed profile');
    assert.equal(await page.locator('#profile-detail').isVisible(), false);
  } finally { await page.close(); }
}


async function longArchiveLazyPhotos(browser) {
  const { page } = await setup(browser, 390);
  try {
    await page.evaluate(() => {
      const seed = window.fixture.versions[0];
      window.fixture.versions = Array.from({length: 220}, (_, i) => ({
        ...seed, id: 'long-version-' + i, version_no: 1, booking_id: 900001 - i, visit_key: 'booking:' + (900001 - i),
        created_at: new Date(Date.UTC(2026, 10, 8, 4, 0, -i)).toISOString(),
        photos: ['front','back','left'].map((angle, index) => ({ id: 'long-asset-' + i + '-' + index, stage: 'before', angle }))
      }));
    });
    await open(page);
    await page.locator('.cda-version').first().locator('img').nth(2).waitFor();
    assert.equal(await page.locator('.cda-version').count(), 220, 'one final design remains readable for each of 220 visits');
    assert.equal(await page.evaluate(() => window.fixture.versions.length), 220, 'long-term stored snapshots are untouched');
    const initial = await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_photo_urls'));
    assert(initial.length > 0 && initial.every(call => call.payload.asset_ids.length <= 30));
    assert(new Set(initial.flatMap(call => call.payload.asset_ids)).size <= 3, 'opening archive signs visible latest original photos only');
    const oldVersion = page.locator('.cda-version').last();
    await page.locator('.cda-visit').last().locator(':scope > summary').click();
    await oldVersion.locator('img').nth(2).waitFor();
    assert((await oldVersion.innerText()).includes('初始-style'), 'old design text survives lazy image loading');
    const calls = await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_photo_urls'));
    assert(calls.every(call => call.payload.asset_ids.length <= 30), '660+ historical assets never produce one oversized signing request');
    assert(calls.some(call => call.payload.asset_ids.includes('long-asset-219-0')), 'expanding old revision fetches its original photos');
  } finally { await page.close(); }
}


async function completionInline(browser, width, mode) {
  const { page, errors } = await setup(browser, width);
  try {
    await page.evaluate(mode => {
      const versions = window.fixture.versions;
      const after = ['front', 'back', 'left'].map((angle, index) => ({
        id: 'completion-' + mode + '-' + index, stage: 'after', angle,
        bucket: 'customer-design-originals', path: 'synthetic/completion-' + index + '.png', mime_type: 'image/png'
      }));
      // An older visit has an after photo in every fixture, to detect accidental cross-visit fallback.
      versions[2].photos = versions[2].photos.filter(photo => photo.stage !== 'after').concat({
        id: 'different-visit-after', stage: 'after', angle: 'front', mime_type: 'image/png'
      });
      versions[0].photos = versions[0].photos.filter(photo => photo.stage !== 'after');
      versions[1].photos = versions[1].photos.filter(photo => photo.stage !== 'after');
      if (mode === 'three-after') versions[0].photos.push(...after);
      if (mode === 'same-visit-fallback') versions[1].photos.push(...after);
    }, mode);
    // Exercise real customer page as well as the real appointment modal. No design/history click occurs.
    await open(page, width === 390 ? 'profile' : 'appointment');
    const visit = page.locator('.cda-visit').first();
    const latest = visit.locator('.cda-version').first();
    assert.equal(await visit.getAttribute('open'), '', 'latest visit is expanded initially');
    assert(await latest.locator('.cda-eight').isVisible(), 'final design content is visible initially');
    const original = latest.locator('.cda-photo-group[data-stage="before"]');
    const completed = latest.locator('.cda-photo-group[data-stage="after"]');
    assert.equal(await completed.count(), 1, 'one permanent completion area per snapshot');
    assert.equal(await completed.locator('h5').innerText(), '完成效果');
    assert(await completed.isVisible(), 'completion area is visible without entering another page or expanding revision');
    assert(await original.evaluate((element) => {
      const after = element.parentElement.querySelector('.cda-photo-group[data-stage="after"]');
      return !!after && !!(element.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'completion area follows original photos on the same page');
    if (mode === 'empty') {
      assert.equal(await completed.locator('img').count(), 0, 'an earlier visit never supplies this visit completion photos');
      assert(await completed.locator('.cda-after-empty').isVisible(), 'unuploaded completion has a visible placeholder');
      assert((await completed.innerText()).includes('尚未上传完成照'));
      assert.equal(await completed.locator('.cda-completion-source').count(), 0);
    } else {
      await completed.locator('img').nth(2).waitFor();
      assert.equal(await completed.locator('img').count(), 3, 'all completed front/back/side photos are inline');
      for (const angle of ['正面', '背面', '左侧']) {
        assert(await completed.locator('img[alt$="' + angle + '"]').isVisible(), 'completed ' + angle + ' is visible without a click');
      }
      assert.equal(await completed.locator('.cda-after-empty').count(), 0);
      if (mode === 'same-visit-fallback') {
        assert((await completed.locator('.cda-completion-source').innerText()).includes('本次已保存完成效果'), 'same-visit completion source is explicit without exposing revision numbers');
        assert(!/第\s*\d+\s*版/.test(await completed.innerText()), 'completion source hides internal revision numbers');
        assert.equal(await page.evaluate(() => window.fixture.versions[0].photos.filter(photo => photo.stage === 'after').length), 0, 'display fallback never mutates latest immutable snapshot');
        assert.equal(await page.evaluate(() => window.fixture.versions[1].photos.filter(photo => photo.stage === 'after').length), 3, 'earlier completion snapshot remains intact');
      }
    }
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.filter(call => /customer_design_(save|upload)$/.test(call.operation)).length, 0, 'viewing completion never creates or repeats records');
    assert(!calls.filter(call => call.operation === 'customer_design_photo_urls').some(call => call.payload.asset_ids.includes('different-visit-after')), 'latest rendering never signs another visit after photo');
    assert.equal(await page.locator('.cda-version').count(), 2, 'each visit presents only its current final design');
    assert.equal(await page.evaluate(() => window.fixture.versions.length), 3, 'every original revision stays stored');
    assert.equal(await page.locator('.cda-visit').count(), 2, 'visits remain separate');
    await fit(page, width);
    assert.equal(errors.length, 0, 'no completion render runtime errors: ' + errors.join(', '));
  } finally { await page.close(); }
}


async function finalDesignOnly(browser) {
  const { page } = await setup(browser, 390);
  try {
    await page.evaluate(() => {
      const original = window.fixture.versions;
      const draft = { ...original[0], id: '00000000-0000-4000-8000-000000000004', version_no: 3, status: 'optimizing', created_at: '2026-11-08T06:00:00.000Z', baseline: { ...original[0].baseline, outline: '不该展示的中间草稿' } };
      const oldDraft = { ...original[2], id: '00000000-0000-4000-8000-000000000005', version_no: 2, status: 'optimizing', created_at: '2026-09-18T06:00:00.000Z', baseline: { ...original[2].baseline, outline: '历史访次最新未确认' } };
      original[2].status = 'baseline';
      window.fixture.versions = [draft, ...original, oldDraft];
      window.snapshotsBeforeRead = JSON.stringify(window.fixture.versions);
    });
    await open(page);
    const finals = page.locator('.cda-version');
    assert.equal(await finals.count(), 2, 'five snapshots from two visits produce two final designs');
    assert.equal(await finals.first().getAttribute('data-version-id'), uuid(3), 'a newer draft does not replace the latest confirmed/completed/followup design');
    assert.equal(await finals.nth(1).getAttribute('data-version-id'), uuid(5), 'without confirmed design, newest draft is the visible plan');
    const html = await page.locator('.cda-history').innerHTML();
    assert(!html.includes('不该展示的中间草稿'), 'intermediate draft is absent from DOM, rather than merely collapsed');
    assert(!/第\s*\d+\s*版|个保存版本/.test(await page.locator('.cda-history').innerText()), 'customer view omits internal revision counts and numbers');
    await page.locator('.cda-visit').nth(1).locator(':scope > summary').click();
    assert((await finals.nth(1).innerText()).includes('历史访次最新未确认'));
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.versions)), await page.evaluate(() => window.snapshotsBeforeRead), 'selection never changes or deletes old snapshots');
    assert.equal(await page.evaluate(() => window.calls.filter(call => /customer_design_(save|upload)$/.test(call.operation)).length), 0);
    await page.locator('[data-action="record"]').click();
    await fill(page, 'baseline', 'outline', '继续修改新草稿并保留确认方案');
    await page.locator('.cda-save-row button[type="submit"]').click();
    await page.waitForFunction(() => window.saved.length === 1 && !document.querySelector('.cda-editor'));
    assert.equal(await page.evaluate(() => window.saved[0].expected_latest_version_id), uuid(4), 'save CAS uses actual newest revision, rather than displayed confirmed revision');
    assert.equal(await page.evaluate(() => window.fixture.versions.length), 6, 'saving another draft appends history');
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.versions.slice(1))), await page.evaluate(() => window.snapshotsBeforeRead), 'all five prior snapshots survive another save unchanged');
  } finally { await page.close(); }
}

async function mobileViewerClose(browser) {
  const { page } = await setup(browser, 390);
  try {
    await page.evaluate(() => { window.snapshotsBeforeRead = JSON.stringify(window.fixture.versions); });
    await open(page);
    await page.locator('.cda-version').first().locator('.cda-photo-open').first().click();
    const viewer = page.locator('dialog.cda-viewer[open]');
    const close = viewer.locator('button');
    await viewer.waitFor();
    const initial = await close.boundingBox();
    assert(initial && initial.y >= 64 && initial.height >= 44, 'iPhone close control clears status/safe area and has 44px touch target');
    // Stress the actual dialog scroll container with long synthetic image content.
    await viewer.evaluate(element => {
      const image = element.querySelector('img');
      image.style.height = '1800px'; image.style.maxHeight = 'none';
      element.scrollTop = 900;
    });
    assert(await viewer.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0), 'large image dialog has scrolled content');
    const scrolled = await close.boundingBox();
    assert(scrolled && scrolled.y >= 64 && scrolled.y + scrolled.height <= 844, 'sticky close remains visible after photo scroll');
    assert(await close.isVisible());
    await close.click();
    await page.locator('dialog.cda-viewer').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.versions)), await page.evaluate(() => window.snapshotsBeforeRead), 'viewing and closing original photo leaves all old snapshots unchanged');
  } finally { await page.close(); }
}

async function hairFormLinkedVisit(browser, width) {
  const { page, errors } = await setup(browser, width);
  try {
    assert(source.includes('id="hair-form-design-open"') && source.includes('openHairFormDesignArchive()'), 'actual hair-analysis form exposes the shared-design entry');
    await page.evaluate(() => {
      window._cloudRecordData = null;
      window._editingHairId = null;
      window._activeHairBookingContext = { bookingId: '900001', bookingDate: '2026-11-08', phone: '13800000000', name: '合成客户', barber: '合成员工' };
      window.getHairRecords = () => [];
      window.hairWrites = 0;
      window.saveHairRecord = () => { window.hairWrites++; };
      window.formAlerts = [];
      window.alert = message => { window.formAlerts.push(String(message)); };
      const form = document.createElement('section');
      form.id = 'hair-source-form';
      form.style.cssText = 'position:relative;z-index:99999;background:white';
      form.innerHTML = '<input id="hair-form-name" value="合成客户"><input id="hair-form-phone" value="13800000000"><input id="hair-form-barber" value="合成员工"><textarea id="hair-form-perm-notes">发质分析表未保存的操作备注</textarea><button id="hair-form-design-open" onclick="openHairFormDesignArchive()">打开本次设计思路</button>';
      document.body.appendChild(form);
    });
    await page.click('#hair-form-design-open');
    await page.locator('#plan-modal .cda-visit').first().waitFor();
    await page.locator('#plan-modal .hair-archive-title').filter({ hasText: '消费记录' }).waitFor();
    assert.equal(await page.locator('#plan-modal.hair-form-design-modal').count(), 1, 'design opens above the existing hair form');
    assert(await page.locator('.hair-design-return').isVisible(), 'onsite employee has a direct return to hair analysis');
    const call = await page.evaluate(() => window.calls.find(item => item.operation === 'customer_design_history'));
    assert.equal(String(call.payload.booking_id), '900001', 'real hair form entry reads the exact active booking');
    assert.equal(call.payload.booking_date, '2026-11-08');
    assert.equal(call.payload.visit_key, 'booking:900001');
    assert.equal(call.payload.phone, '13800000000');
    assert.equal(await page.evaluate(() => window.hairWrites), 0, 'opening design never implicitly saves hair-analysis business data');
    const stack = await page.evaluate(() => ({ form: Number(getComputedStyle(document.querySelector('#hair-source-form')).zIndex), design: Number(getComputedStyle(document.querySelector('#plan-modal')).zIndex) }));
    assert(stack.design > stack.form, 'shared archive remains operable above the source form');
    await page.locator('#plan-modal .customer-read-scope').selectOption('all');
    await page.locator('#plan-modal .cda-visit').first().waitFor();
    assert.equal(await page.locator('#plan-modal.hair-form-design-modal .hair-design-return').count(), 1, 'scope reload preserves the hair-form return context');
    await page.locator('[data-action="record"]').click();
    await fill(page, 'execution', 'actions', '未保存的耳前执行动作', 'ear_front');
    await upload(page);
    await fit(page, width);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.hair-design-return').click();
    assert.equal(await page.locator('.cda-editor').count(), 1, 'return cancellation retains linked design draft');
    assert.equal(await page.locator('[data-group="execution"][data-zone="ear_front"][data-key="actions"]').inputValue(), '未保存的耳前执行动作');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.hair-design-return').click();
    assert.equal(await page.locator('#plan-modal,.cda').count(), 0, 'confirmed return destroys only the design modal');
    assert.equal(await page.locator('#hair-form-perm-notes').inputValue(), '发质分析表未保存的操作备注', 'source form survives design entry/scope changes/return intact');
    assert.equal(await page.evaluate(() => window.hairWrites), 0);
    assert.equal(await page.evaluate(() => window.calls.filter(item => /customer_design_(save|upload)$/.test(item.operation)).length), 0, 'opening and discarding makes no design writes or uploads');
    assert.equal(await page.evaluate(() => window.revokeCount), 1, 'discarded linked design releases only its local preview');
    const priorCalls = await page.evaluate(() => window.calls.length);
    await page.locator('#hair-form-phone').fill('13800000001');
    await page.click('#hair-form-design-open');
    assert.equal(await page.locator('#plan-modal').count(), 0, 'edited identity cannot open a different customer under the old appointment');
    assert.equal(await page.evaluate(() => window.calls.length), priorCalls, 'identity mismatch is stopped before network lookup');
    assert((await page.evaluate(() => window.formAlerts.at(-1))).includes('不一致'));
    assert.equal(errors.length, 0, 'hair-form linked entry has no runtime errors: ' + errors.join(', '));
  } finally { await page.close(); }
}

let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  const failures = [], passes = [];
  async function check(name, run) {
    try { await run(); passes.push(name); console.log('PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.stack); console.error('FAIL ' + name + ': ' + error.message); }
  }
  for (const width of [320, 390, 768]) {
    await check('modal/history/photos/finance ' + width, () => viewing(browser, width));
    await check('appointment/manual save ' + width, () => manualSave(browser, width, 'appointment'));
    await check('customer archive/manual visit ' + width, () => manualSave(browser, width, 'customer'));
    await check('actual customer profile/manual visit ' + width, () => manualSave(browser, width, 'profile'));
    await check('hair analysis shares exact design visit ' + width, () => hairFormLinkedVisit(browser, width));
    for (const mode of ['empty', 'three-after', 'same-visit-fallback']) {
      await check('completion inline ' + mode + ' ' + width, () => completionInline(browser, width, mode));
    }
  }
  await check('one final design per visit without deleting history', () => finalDesignOnly(browser));
  await check('mobile original photo safe-area sticky close', () => mobileViewerClose(browser));
  await check('long archive lazy original photos', () => longArchiveLazyPhotos(browser));
  await check('actual profile back guard and response race', () => profileReturnAndRace(browser));
  await check('unsaved guard and cleanup', () => unsavedGuard(browser));
  await check('own-store write in shared view', () => scopePermission(browser, false));
  await check('other-store read-only view', () => scopePermission(browser, true));
  if (failures.length) throw new Error(failures.length + '/' + (passes.length + failures.length) + ' integration cases failed:\n\n' + failures.join('\n\n'));
  console.log('customer design integration browser tests passed: ' + passes.length + ' synthetic modal cases');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
