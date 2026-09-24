#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'perm-app.html'), 'utf8');
const required = [
  ["latest visits use newest-first data", "visitHistory.slice(0, showCount)"],
  ["bill identity deduplication", "sourceId ? 'id:' + sourceId"],
  ["bill item detail rendering", "var projectText = h.items && h.items.length ? h.items.join('、') : '消费记录';"],
  ["bill staff detail rendering", "h.staff && h.staff.length ? h.staff.join('、') : h.barber"],
  ["package expiry rendering", "pkg.expireDate ? '有效期至' + pkg.expireDate : ''"],
  ["paginated Supabase archive reader", "function fetchAllSupabaseRows(baseUrl, pageSize)"],
  ["complete active hair record loading", "return fetchAllSupabaseRows(url, 1000);"],
  ["plan history uses canonical hair records", "fetchHairRecordsForCustomer(phone, name, 0).then"],
  ["plan history opens the complete saved form", "class=\"hair-full-archive-btn\""],
  ["plan history preserves customer name fallback", "class=\"hair-history-toggle\" data-phone="],
  ["customer archive uses complete hair rows", "var hairRecordsPromise = fetchAllActiveHairRecordRows()"],
  ["unidentified records remain visible for manual linking", "hasIdentity ? '未知' : '待关联顾客'"],
  ["perm note input", 'id="hair-form-perm-notes"'],
  ["perm note save", "permNotes: F['hair-form-perm-notes'] || ''"],
  ["perm note restore", "setVal('hair-form-perm-notes', data.permNotes)"],
  ["archive identity guard", "var archiveIdentity = canonicalizeHairRecordIdentity(record);"],
  ["archive top-level customer name sync", "customer_name: record.customerName"],
  ["archive top-level customer phone sync", "customer_phone: record.customerPhone"],
];

const forbidden = [
  ["oldest-three visit regression", "visitHistory.slice(visitHistory.length - showCount)"],
  ["hard-coded twelve-row history truncation", "history.slice(0, 12).forEach"],
  ["hard-coded 200-row customer hair archive", "var hairRecordsPromise = fetch(SUPABASE_URL + '/rest/v1/hair_records?select=id,customer_name,customer_phone,technician,barber,status,record_data,created_at&status=neq.deleted&order=created_at.desc&limit=200'"],
  ["silently swallowed complete hair archive failure", "var hairRecordsPromise = fetchAllActiveHairRecordRows().catch"],
];

const failures = [];
for (const [label, marker] of required) {
  if (!source.includes(marker)) failures.push(`missing ${label}`);
}
for (const [label, marker] of forbidden) {
  if (source.includes(marker)) failures.push(`found ${label}`);
}
const planHistoryStart = source.indexOf('window.toggleCustomerHistory = function(phone, name)');
const planHistoryEnd = source.indexOf('// 事件委托：处理 data-phone', planHistoryStart);
if (planHistoryStart < 0 || planHistoryEnd < 0) {
  failures.push('unable to isolate plan history loader');
} else if (source.slice(planHistoryStart, planHistoryEnd).includes('hair_analysis_queue')) {
  failures.push('plan history still reads the legacy hair analysis queue');
}
const saveMatches = source.match(/permNotes: F\['hair-form-perm-notes'\] \|\| ''/g) || [];
if (saveMatches.length < 2) failures.push('perm notes must be saved by draft and archive paths');

async function testCompleteHairRecordPagination() {
  const start = source.indexOf('function fetchAllSupabaseRows(baseUrl, pageSize)');
  const end = source.indexOf('function fetchHairRecordsForCustomer(phone, name, limit)', start);
  if (start < 0 || end < 0) {
    failures.push('unable to isolate complete hair record pagination functions');
    return;
  }
  const rows = Array.from({ length: 2205 }, (_, id) => ({ id: String(id + 1) }));
  const offsets = [];
  const context = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_KEY: 'publishable-test-key',
    fetch: async function(url) {
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get('offset') || 0);
      const limit = Number(parsed.searchParams.get('limit') || 1000);
      offsets.push(offset);
      return {
        ok: true,
        json: async function() { return rows.slice(offset, offset + limit); },
      };
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const loaded = await context.fetchAllActiveHairRecordRows();
  if (loaded.length !== rows.length) failures.push(`pagination loaded ${loaded.length}/${rows.length} hair records`);
  if (offsets.join(',') !== '0,1000,2000') failures.push(`unexpected pagination offsets: ${offsets.join(',')}`);
}

async function testPlanHistoryUsesCanonicalRecords() {
  const start = source.indexOf('function renderCustomerHistoryButton(phone, name, message, isError)');
  const end = source.indexOf('// 事件委托：处理 data-phone', start);
  if (start < 0 || end < 0) {
    failures.push('unable to isolate customer plan history functions');
    return;
  }
  const container = {
    innerHTML: '',
    querySelector() { return null; },
  };
  const calls = [];
  const escape = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const context = {
    window: {},
    document: { getElementById: id => id === 'plan-customer-history' ? container : null },
    esc: escape,
    escAttr: escape,
    fetchHairRecordsForCustomer: async function(phone, name, limit) {
      calls.push({ phone, name, limit });
      return [
        { id: 'hair-3', createdAt: '2026-09-12T02:00:00Z', customerPhone: phone, barber: '无名', status: '技师已完成' },
        { id: 'hair-2', visitDate: '2026-07-31', customerPhone: phone, technician: '小邱', serviceType: 'both', status: '回访完成' },
        { id: 'hair-1', bookingDate: '2026-07-04', customerPhone: phone, serviceType: 'perm', status: '回访完成' },
      ];
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  context.window.renderCustomerHistory('18600000216', '测试顾客');
  if (!container.innerHTML.includes('data-name="测试顾客"')) failures.push('history toggle lost customer-name fallback');
  await context.window.toggleCustomerHistory('18600000216', '测试顾客');
  if (JSON.stringify(calls) !== JSON.stringify([{ phone: '18600000216', name: '测试顾客', limit: 0 }])) {
    failures.push('plan history did not request the complete canonical customer archive');
  }
  const archiveButtons = container.innerHTML.match(/class="hair-full-archive-btn"/g) || [];
  if (archiveButtons.length !== 3) failures.push(`plan history rendered ${archiveButtons.length}/3 saved records`);
  for (const date of ['2026-09-12', '2026-07-31', '2026-07-04']) {
    if (!container.innerHTML.includes(date)) failures.push(`plan history omitted ${date}`);
  }
  if (!container.innerHTML.includes('查看完整表')) failures.push('plan history records cannot open the complete form');
}

(async function main() {
  await testCompleteHairRecordPagination();
  await testPlanHistoryUsesCanonicalRecords();
  if (failures.length) {
    console.error(`customer archive regression test failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('customer archive regression test passed: complete 2205-row pagination');
})().catch(function(error) {
  console.error(`customer archive regression test failed:\n- ${error.stack || error}`);
  process.exit(1);
});
