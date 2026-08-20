#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontdesk.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontdesk-manifest.json'), 'utf8'));
const edge = fs.readFileSync(path.join(root, 'supabase/functions/frontdesk-api/index.ts'), 'utf8');
const releaseVersion = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805032115_frontdesk_customer_center.sql'), 'utf8');
const indexMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805032309_frontdesk_import_batch_index.sql'), 'utf8');
const receptionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805040356_frontdesk_today_reception.sql'), 'utf8');
const receptionTimeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805050029_frontdesk_reception_time.sql'), 'utf8');
const ledgerEditMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260805123808_frontdesk_ledger_edit_fields.sql'), 'utf8');
const ledgerAmountMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260806035941_frontdesk_ledger_amount_fields.sql'), 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
expect(scriptMatch, 'frontdesk inline script missing');
new Function(scriptMatch[1]);

const elements = new Map();
function fakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
  };
}
const runtimeScript = scriptMatch[1].replace(
  'restoreSession();',
  'globalThis.__frontdeskTest={timeMinutes,minuteLabel,bookingPlaceholder,resolvedBarber,mergeToday,todayState,scheduleRange,scheduleScrollLeft,phoneSuffixQuery,ledgerRowMatchesQuery,ledgerAmountLabel,openTodayForm};',
);
const runtimeContext = {
  console,
  document: {
    hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
  },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; },
  requestAnimationFrame(callback) { callback(); },
};
vm.runInNewContext(runtimeScript, runtimeContext);
const timeline = runtimeContext.__frontdeskTest;
const sampleRows = timeline.mergeToday({
  barbers: ['小康'],
  bookings: [
    { customer_name: '', customer_phone: '', barber_name: '郭小康', time_label: '10:30', status: 4 },
    { customer_name: '示例客户', customer_phone: '13800000000', barber_name: '郭小康', time_label: '11:00', status: 0 },
  ],
  services: [], reception: [],
});
expect(sampleRows.length === 1, 'empty Meiguanjia availability placeholder must not become a customer card');
expect(sampleRows[0].barber === '小康', 'Meiguanjia barber alias must resolve to active staff name');
expect(timeline.timeMinutes('11:30:00') === 690 && timeline.minuteLabel(690) === '11:30', 'schedule time parsing failed');
const defaultRange = timeline.scheduleRange(sampleRows);
expect(defaultRange.start === 600 && defaultRange.end === 1320, 'schedule must default to 10:00-22:00');
expect(timeline.scheduleScrollLeft(null) === 0, 'first schedule view must start at the earliest business time');
expect(timeline.scheduleScrollLeft(728) === 728, 'refresh must preserve the operator scroll position');
const completedRows = timeline.mergeToday({
  barbers: ['小康'],
  bookings: [{ customer_name: '完成客户', customer_phone: '13800000001', barber_name: '小康', time_label: '10:30', status: 4 }],
  services: [{ customer_name: '完成客户', customer_phone: '13800000001', service_time: '10:30', staff: ['小康'], items: [{ name: '剪发' }], amount: 100 }],
  reception: [],
});
expect(completedRows.length === 1 && completedRows[0].kind === 'matched', 'completed service customer must remain on the schedule');
expect(timeline.todayState(completedRows[0]).tone === 'green', 'completed service customer must keep the completed visual state');
expect(timeline.phoneSuffixQuery('3360') === '3360', 'exact four-digit phone suffix must be recognized');
expect(timeline.phoneSuffixQuery('13360') === '' && timeline.phoneSuffixQuery('33a0') === '', 'only exact four digits may activate suffix mode');
expect(timeline.ledgerRowMatchesQuery({ customer_phone: '13812343360', service_items: '护理 7788' }, '3360'), 'ledger phone suffix must match the end of the customer phone');
expect(!timeline.ledgerRowMatchesQuery({ customer_phone: '13833601234', service_items: '套餐 3360' }, '3360'), 'four digits must not match a phone middle segment or another ledger field');
expect(timeline.ledgerRowMatchesQuery({ customer_phone: '13812343360', customer_name: '朱小姐' }, '朱小姐'), 'name search must remain supported');
expect(timeline.ledgerAmountLabel({ amount: 128, payment_summary: '微信' }) === '¥128 · 微信', 'ledger must display numeric amount and explanation together');
expect(timeline.ledgerAmountLabel({ amount: 0, payment_summary: '', package_note: '' }) === '—', 'empty ledger amount must keep a clear placeholder');
expect(timeline.ledgerRowMatchesQuery({ amount: 128.5, customer_name: '金额客户' }, '128.5'), 'ledger amount must remain searchable');
timeline.openTodayForm({ reception: { id: 'today-1', business_date: '2026-08-06', customer_name: '金额客户', barber_name: '小康', arrival_time: '11:00', amount: 188.5, payment_summary: '微信' } });
expect(elements.get('today-amount').value === '188.5' && elements.get('today-payment-summary').value === '微信', 'today appointment edit must restore amount and explanation');
timeline.openTodayForm({ name: '美管加客户', barber: '小康', time: '11:30', amount: 999 });
expect(elements.get('today-amount').value === '' && elements.get('today-payment-summary').value === '', 'new reception must not copy a Meiguanjia service amount automatically');

expect(new RegExp(`<html[^>]+data-version="${releaseVersion}"`).test(html), 'frontdesk version must match current release');
expect(html.includes('前台客户中心') && html.includes('今日客户') && html.includes('客户档案'), 'core frontdesk views missing');
expect(html.includes('全部已同步消费记录') && html.includes('套餐余项'), 'customer history or package balance UI missing');
expect(html.includes('美管加历史明细尚未完整回传'), 'customer data-gap warning missing');
expect(html.includes('美管加负责收银') && html.includes('不会执行收银'), 'cashier responsibility boundary missing');
expect(html.includes('发型师时间预览') && html.includes('schedule-grid') && html.includes('schedule-slot'), 'barber timeline grid missing');
expect(html.includes('10:00') || html.includes('var start=600'), 'default 10:00 timeline start missing');
expect(html.includes('已过去时段和已完成客户都会保留'), 'past times and completed customer visibility note missing');
expect(!html.includes('var focus=showNow?nowMinute'), 'schedule must not auto-hide past times by jumping to now');
expect(html.includes('minute+=30') && html.includes('点击空白时间格快速登记'), '30-minute quick-add schedule behavior missing');
expect(html.includes('bookingPlaceholder') && html.includes("available?'✋':'＋'"), 'empty Meiguanjia booking slots must render as available schedule cells');
expect(html.includes('resolvedBarber') && html.includes('name.endsWith(item)'), 'Meiguanjia/staff barber alias reconciliation missing');
expect(html.includes('添加今日客户') && html.includes('当天前台备注') && html.includes('id="today-time"'), 'timed daily reception form missing');
expect(html.includes('store-select') && html.includes('zysyr-frontdesk-store-v1'), 'persistent branch selection missing');
expect(html.includes('电脑前台为主') && manifest.description.includes('电脑前台'), 'desktop-first frontdesk positioning missing');
expect(html.includes('id="ledger-table"') && html.includes('class="ledger-table"'), 'customer ledger table missing');
expect(html.includes('当日接待') && html.includes('历史导入') && html.includes('所有修改仅作用于前台独立数据表'), 'ledger source boundary missing');
expect(html.includes("api('ledger_records'") && html.includes('loadLedger') && html.includes('renderLedger'), 'customer ledger read flow missing');
expect(html.includes("api('ledger_records',suffix?{phone_suffix:suffix}:{})") && html.includes('phoneSuffixQuery') && html.includes('endsWith(suffix)'), 'ledger phone-suffix query flow missing');
expect(html.includes("api('ledger_record_save'") && html.includes('openLedgerForm') && html.includes('项目 / 发型师 / 技师 / 助理'), 'ledger editable staff/project flow missing');
expect(html.includes('id="ledger-amount"') && html.includes('id="ledger-payment-summary"') && html.includes('实际金额（元）') && html.includes('金额说明'), 'ledger amount edit fields missing');
expect(html.includes("amount:$('ledger-amount').value") && html.includes("payment_summary:$('ledger-payment-summary').value.trim()"), 'ledger amount fields must be submitted');
expect(html.includes('原始上传表格内容、客户主档和美管加收银数据保持不变'), 'ledger financial edit boundary missing');
expect(html.includes('id="today-technician"') && html.includes('id="today-assistant"'), 'daily reception technician/assistant fields missing');
expect(html.includes('id="today-amount"') && html.includes('id="today-payment-summary"'), 'daily reception amount edit fields missing');
expect(html.includes("amount:$('today-amount').value") && html.includes("payment_summary:$('today-payment-summary').value.trim()"), 'daily reception amount fields must be submitted');
expect(html.includes('当天客户、金额和说明已同步到客户数据表'), 'daily reception amount save confirmation missing');
expect(html.includes('id="schedule-left"') && html.includes('id="schedule-right"') && html.includes('overflow-x:scroll'), 'explicit horizontal schedule navigation missing');
expect(html.includes('id="register-form"') && html.includes("api('register'") && html.includes('提交后由管理员在后台审核'), 'frontdesk registration flow missing');
expect(html.includes("$('import-tools').classList.toggle('hidden',!user.can_import)") && !html.includes("$('import-area')"), 'CSV tools permission boundary missing');
expect(html.includes("Promise.all([loadDashboard(),loadLedger()])") && html.includes('原客户档案未修改'), 'daily reception save must refresh ledger without changing master profile');
expect(html.includes('pkg.package_name||pkg.name'), 'package card must prefer the recognizable package name');
expect(!html.includes("'Authorization':'Bearer '+SUPABASE_KEY"), 'publishable API key must not be sent as a bearer token');
expect(html.includes("setInterval(function(){if(!document.hidden&&state.session&&state.view==='today')loadDashboard();},60000)"), 'one-minute foreground refresh missing');
expect(html.includes("accept=\".csv,.tsv"), 'CSV import entry missing');
expect(!html.includes('SUPABASE_SERVICE_ROLE_KEY'), 'service role key must never appear in frontdesk HTML');
expect(admin.includes('href="frontdesk.html"'), 'admin entry to frontdesk missing');

expect(manifest.start_url === 'frontdesk.html', 'frontdesk manifest start_url mismatch');
expect(manifest.display === 'standalone' && manifest.orientation === 'landscape', 'frontdesk iPad PWA settings missing');

expect(edge.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'), 'Edge Function must read service role from environment');
expect(edge.includes('frontdesk_sessions') && edge.includes('requireSession'), 'protected frontdesk session missing');
expect(edge.includes('const SESSION_DAYS = 3650') && edge.includes('staff?select=username,role,position,store,active,employment_status'), 'persistent revalidated device session missing');
expect(edge.includes('availableStores') && edge.includes('请先选择分店'), 'server-side multi-store handling missing');
expect(edge.includes('today_customer_save') && edge.includes('frontdesk_today_customers'), 'daily reception API missing');
expect(edge.includes('service_intent,amount,payment_summary,reception_notes'), 'dashboard must return saved reception amount fields');
expect(edge.includes('arrival_time') && edge.includes('到店时间无效'), 'validated daily reception time missing');
expect(edge.includes('reservation_time') && edge.includes('order=arrival_time.asc.nullslast'), 'schedule time sources or ordering missing');
expect(edge.includes('operation === "logout"') && edge.includes('async function logout'), 'server-side logout missing');
expect(edge.includes('/前台|店长/') && edge.includes('canImport'), 'frontdesk and manager permission checks missing');
expect(edge.includes('customer_profiles') && edge.includes('mgj_service_records'), 'Meiguanjia customer sources missing');
expect(edge.includes('function customerPhonesMatch') && edge.includes('a.slice(-11) === b.slice(-11)'), 'normalized customer phone matching missing');
expect(edge.includes('summary_without_history'), 'server-side customer data-gap signal missing');
expect(edge.includes('rpc/import_frontdesk_records'), 'protected import RPC missing');
expect(edge.includes('单次最多导入 250 行'), 'import batch limit missing');
expect(edge.includes('operation === "ledger_records"') && edge.includes('async function ledgerRecords'), 'protected customer ledger API missing');
expect(edge.includes('phoneSuffix ? `*${phoneSuffix}`') && edge.includes('phoneSuffix ? 1000 : 80') && edge.includes('phoneSuffix ? sortedResults') && edge.includes('手机号后4位格式错误'), 'customer search phone-suffix rule missing');
expect(edge.includes('operation === "ledger_record_save"') && edge.includes('async function saveLedgerRecord'), 'protected ledger edit API missing');
expect(edge.includes('金额最多保留两位小数') && edge.includes('金额超出允许范围'), 'ledger amount validation missing');
expect(edge.includes('operation === "register"') && edge.includes('employment_status: "pending"') && edge.includes('position: "前台"'), 'frontdesk pending registration API missing');
expect(edge.includes('selectCustomerRows') && edge.includes('distinctPhones.size === 1') && edge.includes('comparableCustomerName'), 'masked phone package matching fix missing');
const customerSearchFunction = edge.slice(edge.indexOf('async function customerSearch'), edge.indexOf('function parseArray'));
expect(customerSearchFunction.includes('const store = selectedStore(session, payload)') && customerSearchFunction.includes('if (!store) throw new Error("请先选择分店")'), 'customer search must require the session-selected store');
expect(customerSearchFunction.includes('withStore(`customer_profiles?') && customerSearchFunction.includes('"shop_name", store'), 'customer profile search must be scoped to the selected store');
expect(customerSearchFunction.includes('withStore(`frontdesk_import_records?') && customerSearchFunction.includes('"store", store'), 'imported customer search must be scoped to the selected store');
expect(customerSearchFunction.includes('remainingPackageCount(row.card_packages, store)'), 'customer search package count must exclude other stores');
const packageFunction = edge.slice(edge.indexOf('function collectPackages'), edge.indexOf('function historyFromProfiles'));
expect(packageFunction.includes('packageStore && packageStore !== store'), 'customer packages must reject rows explicitly owned by another store');
const profileHistoryFunction = edge.slice(edge.indexOf('function historyFromProfiles'), edge.indexOf('function selectCustomerRows'));
expect(profileHistoryFunction.includes('historyStore && historyStore !== store'), 'embedded profile history must reject rows explicitly owned by another store');
const customerDetailFunction = edge.slice(edge.indexOf('async function customerDetail'), edge.indexOf('function validDate'));
expect(customerDetailFunction.includes('async function customerDetail(payload: JsonRecord, session: JsonRecord)') && customerDetailFunction.includes('const store = selectedStore(session, payload)'), 'customer detail must use the authenticated session store');
expect(customerDetailFunction.includes('withStore(`customer_profiles?') && customerDetailFunction.includes('withStore(`mgj_service_records?') && customerDetailFunction.includes('withStore(`frontdesk_import_records?'), 'every customer detail source must be store-scoped');
expect(customerDetailFunction.includes('historyFromProfiles(profiles, store)') && customerDetailFunction.includes('collectPackages(profiles, store)'), 'customer detail history and packages must preserve store isolation');
expect(edge.includes('customerDetail(payload, session)'), 'customer detail route must pass the authenticated session');
expect(edge.includes('operation === "admin_overview"') && edge.includes('requireFrontdeskAdmin'), 'frontdesk backend management API missing');
expect(edge.includes('original_customer_profiles_untouched: true'), 'ledger response must declare original customer profile boundary');
const ledgerFunction = edge.slice(edge.indexOf('async function ledgerRecords'), edge.indexOf('Deno.serve'));
expect(ledgerFunction.includes('frontdesk_import_records') && ledgerFunction.includes('frontdesk_today_customers'), 'ledger must combine imported and daily reception rows');
expect(ledgerFunction.includes('withStore('), 'ledger rows must be store-scoped');
expect(ledgerFunction.includes('customer_phone=ilike.') && ledgerFunction.includes('phone_suffix: rawPhoneSuffix'), 'ledger suffix search must run server-side across historical rows');
const saveFunction = edge.slice(edge.indexOf('async function saveTodayCustomer'), edge.indexOf('function remainingPackageCount'));
expect(saveFunction.includes('frontdesk_today_customers') && !saveFunction.includes('customer_profiles') && !saveFunction.includes('frontdesk_import_records'), 'daily reception save must not overwrite customer master or imported history');
expect(saveFunction.includes('amount: frontdeskAmount(payload.amount)') && saveFunction.includes('payment_summary: cleanText(payload.payment_summary, 500)'), 'daily reception save must persist amount and explanation');
const ledgerSaveFunction = edge.slice(edge.indexOf('async function saveLedgerRecord'), edge.indexOf('function adminStore'));
expect(ledgerSaveFunction.includes('amount: frontdeskAmount(payload.amount)') && ledgerSaveFunction.includes('payment_summary: cleanText(payload.payment_summary, 500)'), 'ledger save must persist amount and explanation');
expect(ledgerSaveFunction.includes('rowType === "today"') && ledgerSaveFunction.includes('frontdesk_import_records'), 'both ledger row types must support amount edits');
expect((edge.match(/frontdeskAmount\(payload\.amount\)/g) || []).length === 2, 'today and ledger saves must share the same amount validation');

['frontdesk_sessions', 'frontdesk_import_batches', 'frontdesk_import_records'].forEach((table) => {
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`public.${table}`), `${table} migration missing`);
});
expect(migration.includes('revoke all on function public.import_frontdesk_records'), 'import RPC public revoke missing');
expect(migration.includes('grant execute on function public.import_frontdesk_records') && migration.includes('to service_role'), 'import RPC service-role grant missing');
expect(indexMigration.includes('frontdesk_import_records (batch_id)'), 'import batch foreign-key index missing');
expect(receptionMigration.includes('frontdesk_today_customers'), 'daily reception table missing');
expect(receptionMigration.includes('alter table public.frontdesk_today_customers enable row level security'), 'daily reception RLS missing');
expect(receptionMigration.includes('revoke all on table public.frontdesk_today_customers from public, anon, authenticated'), 'daily reception public revoke missing');
expect(receptionTimeMigration.includes('add column if not exists arrival_time time without time zone'), 'daily reception time column missing');
expect(receptionTimeMigration.includes('frontdesk_today_customers_schedule_idx'), 'daily reception schedule index missing');
expect(ledgerEditMigration.includes('technician_name') && ledgerEditMigration.includes('assistant_name'), 'daily reception staff edit columns missing');
expect(ledgerEditMigration.includes('frontdesk_import_records') && ledgerEditMigration.includes('updated_by'), 'imported ledger audit columns missing');
expect(ledgerAmountMigration.includes('amount numeric(12,2)') && ledgerAmountMigration.includes('payment_summary text'), 'today ledger amount columns missing');
expect(ledgerAmountMigration.includes('raw_row') && ledgerAmountMigration.includes('does not create or change a Meiguanjia cashier transaction'), 'ledger amount source boundary comments missing');
expect(ledgerAmountMigration.includes('enable row level security') && ledgerAmountMigration.includes('revoke all on table public.frontdesk_today_customers from public, anon, authenticated'), 'ledger amount migration must preserve server-only access');

console.log('frontdesk tests passed');
