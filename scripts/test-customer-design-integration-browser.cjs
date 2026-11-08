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
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
const keys = ['style', 'person', 'length', 'features', 'layers', 'bangs', 'curls', 'care'];
const labels = ['风格', '人物', '长度', '发型特点', '层次', '刘海', '卷度', '打理'];
const makeModel = prefix => ({ outline: prefix + '轮廓', root_flow: prefix + '毛流', steps: Object.fromEntries(keys.map(key => [key, prefix + key])) });
const reasons = Object.fromEntries(['outline', 'root_flow', ...keys].map(key => [key, '沟通调整理由-' + key]));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const photos = ['front', 'back', 'left'].map((angle, i) => ({ id: uuid(100 + i), stage: 'before', angle, bucket: 'customer-design-originals', path: 'synthetic/' + i + '.png', mime_type: 'image/png' }));
  photos.push({ id: uuid(103), stage: 'after', angle: 'front', bucket: 'customer-design-originals', path: 'synthetic/after.png', mime_type: 'image/png' });
  const version = (id, versionNo, date, booking, extra = {}) => ({ id: uuid(id), version_no: versionNo, booking_id: booking, visit_id: booking ? 'booking:' + booking : uuid(400), visit_key: booking ? 'booking:' + booking : 'manual:' + date, booking_date: date, created_at: date + 'T04:' + String(versionNo).padStart(2, '0') + ':00.000Z', status: 'confirmed', baseline: makeModel('初始-'), optimized: makeModel('优化-'), reasons, photos, source: 'manual', author: { name: '合成员工' }, shop_name: '自由手艺人', ...extra });
  return {
    versions: [version(3, 2, '2026-11-08', 900001), version(2, 1, '2026-11-08', 900001), version(1, 1, '2026-09-18', 899999)],
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
  await page.addScriptTag({ content: moduleSource + '\n' + modal + '\n' + archives + '\n' + profileDetail });
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
        const version = { id: '00000000-0000-4000-8000-' + String(800 + window.saved.length).padStart(12, '0'), version_no: sameVisit.length + 1, previous_version_id: payload.expected_latest_version_id, booking_id: payload.booking_id, visit_id: payload.visit_id || 'manual:' + payload.booking_date, visit_key: payload.visit_key, booking_date: payload.booking_date, created_at: payload.booking_date + 'T05:00:00.000Z', baseline: payload.baseline, optimized: payload.optimized, reasons: payload.reasons, status: payload.status, source: 'manual', author: { name: '合成员工' }, shop_name: '自由手艺人', photos: payload.photo_ids.map(id => { const found = window.fixture.versions.flatMap(v => v.photos || []).find(p => p.id === id); return found || { id, stage: 'after', angle: 'right', mime_type: 'image/png' }; }) };
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
async function fill(page, group, key, value) {
  const locator = page.locator('.cda-editor [data-group="' + group + '"][data-key="' + key + '"]');
  await locator.evaluate(element => { const details = element.closest('details'); if (details) details.open = true; });
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
    assert.equal(await page.locator('.cda-version').count(), 3, 'every saved revision remains in DOM');
    await latest.locator('img[alt^="原始照片"]').nth(2).waitFor();
    assert.equal(await latest.locator('.cda-photo-group').filter({ has: page.locator('h5', { hasText: '原始照片' }) }).locator('img').count(), 3, 'front, back, side originals appear in App');
    assert.equal(await latest.locator('img[alt^="完成照片"]').count(), 1, 'after stage remains distinct');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.cda-version[open] img')).every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await latest.locator('.cda-eight .cda-compare').count(), 8, 'eight design steps are individually shown');
    for (const [index, label] of labels.entries()) {
      const row = latest.locator('.cda-eight .cda-compare').nth(index);
      const text = await row.innerText();
      assert(text.includes(label) && text.includes('初始-' + keys[index]) && text.includes('优化-' + keys[index]) && text.includes('沟通调整理由-' + keys[index]), 'baseline/optimization/reason shown for ' + label);
    }
    assert((await latest.locator('.cda-outline').innerText()).includes('整体轮廓'));
    assert((await latest.locator('.cda-outline').innerText()).includes('发根毛流方向'));
    assert((await latest.locator('.cda-byline').innerText()).includes('合成员工 · 员工手动填写'));
    await latest.locator('.cda-photo-open').first().click();
    assert.equal(await page.locator('dialog.cda-viewer[open]').count(), 1, 'original photo opens enlarged');
    await page.locator('dialog.cda-viewer button').click();
    await page.locator('dialog.cda-viewer').waitFor({ state: 'detached' });
    assert.equal(await page.locator('dialog.cda-viewer').count(), 0, 'viewer cleans up');
    await page.locator('.cda-visit').nth(1).locator(':scope > summary').click();
    await page.locator('.cda-visit').nth(1).locator('.cda-version > summary').click();
    assert((await page.locator('.cda-visit').nth(1).innerText()).includes('2026-09-18'), 'past visit/revision is expandable');
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
    await upload(page);
    await fit(page, width);
    await page.evaluate(() => { window.failSave = true; });
    await page.locator('.cda-save-row button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.cda-draft-feedback')?.textContent.includes('synthetic save failed'));
    assert.equal(await page.locator('[data-group="baseline"][data-key="outline"]').inputValue(), '人工初判：纵向椭圆', 'failed save retains all text');
    assert.equal(await page.locator('.cda-editor img[alt^="完成照片"]').count(), entry === 'appointment' ? 2 : 1, 'failed save retains picked files and existing after originals');
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
    assert(saved.photo_ids.length === (entry === 'appointment' ? 5 : 1), 'saved new version carries its precise photos');
    assert.equal(await page.locator('.cda-version').count(), 4, 'new save appends rather than overwriting prior states');
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
        ...seed, id: 'long-version-' + i, version_no: 220 - i,
        created_at: new Date(Date.UTC(2026, 10, 8, 4, 0, -i)).toISOString(),
        photos: ['front','back','left'].map((angle, index) => ({ id: 'long-asset-' + i + '-' + index, stage: 'before', angle }))
      }));
    });
    await open(page);
    await page.locator('.cda-version').first().locator('img').nth(2).waitFor();
    assert.equal(await page.locator('.cda-version').count(), 220, 'all long-term versions remain readable');
    const initial = await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_photo_urls'));
    assert(initial.length > 0 && initial.every(call => call.payload.asset_ids.length <= 30));
    assert(new Set(initial.flatMap(call => call.payload.asset_ids)).size <= 3, 'opening archive signs visible latest original photos only');
    const oldVersion = page.locator('.cda-version').last();
    await oldVersion.locator(':scope > summary').click();
    await oldVersion.locator('img').nth(2).waitFor();
    assert((await oldVersion.innerText()).includes('初始-style'), 'old design text survives lazy image loading');
    const calls = await page.evaluate(() => window.calls.filter(call => call.operation === 'customer_design_photo_urls'));
    assert(calls.every(call => call.payload.asset_ids.length <= 30), '660+ historical assets never produce one oversized signing request');
    assert(calls.some(call => call.payload.asset_ids.includes('long-asset-219-0')), 'expanding old revision fetches its original photos');
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
  }
  await check('long archive lazy original photos', () => longArchiveLazyPhotos(browser));
  await check('actual profile back guard and response race', () => profileReturnAndRace(browser));
  await check('unsaved guard and cleanup', () => unsavedGuard(browser));
  await check('own-store write in shared view', () => scopePermission(browser, false));
  await check('other-store read-only view', () => scopePermission(browser, true));
  if (failures.length) throw new Error(failures.length + '/' + (passes.length + failures.length) + ' integration cases failed:\n\n' + failures.join('\n\n'));
  console.log('customer design integration browser tests passed: ' + passes.length + ' synthetic modal cases');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
