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
  ["customer archive uses complete hair rows", "var hairRecordsPromise = fetchAllActiveHairRecordRows()"],
  ["unidentified records remain visible for manual linking", "hasIdentity ? '未知' : '待关联顾客'"],
  ["perm note input", 'id="hair-form-perm-notes"'],
  ["perm note save", "permNotes: F['hair-form-perm-notes'] || ''"],
  ["perm note restore", "setVal('hair-form-perm-notes', data.permNotes)"],
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

(async function main() {
  await testCompleteHairRecordPagination();
  if (failures.length) {
    console.error(`customer archive regression test failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('customer archive regression test passed: complete 2205-row pagination');
})().catch(function(error) {
  console.error(`customer archive regression test failed:\n- ${error.stack || error}`);
  process.exit(1);
});
