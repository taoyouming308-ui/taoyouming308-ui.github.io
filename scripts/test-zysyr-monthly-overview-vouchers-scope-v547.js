const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = api.indexOf('async function reportUploadVouchers(');
const end = api.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'scoped report voucher reader must exist');
const helper = api.slice(start, end);
const calls = [];
const sandbox = {
  cleanText: value => String(value ?? '').trim().slice(0, 40),
  uuidIn: values => `(${Array.from(new Set(values.filter(value => /^[0-9a-f-]{36}$/i.test(value)))).join(',')})`,
  restRowsAll: async (path, maxRows) => { calls.push({ path, maxRows }); return [{ record_id: path.match(/record_id=in\.\(([^)]*)\)/)?.[1] || '' }]; },
};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(`${helper}\nthis.readVouchers = reportUploadVouchers;`), sandbox);

(async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`);
  const reports = ids.map(id => ({ id })).concat([{ id: ids[0] }, { id: 'not-a-uuid' }]);
  const rows = await sandbox.readVouchers('company-id', 'store-id', reports);
  assert.equal(calls.length, 3, 'the lookup must keep each filter URL bounded to 100 report IDs');
  assert.deepEqual(calls.map(call => call.maxRows), [1000, 1000, 1000]);
  for (const call of calls) {
    assert.match(call.path, /company_id=eq\.company-id&store_id=eq\.store-id&record_type=eq\.report/);
    assert.match(call.path, /record_id=in\.\(/);
    const filterIds = call.path.match(/record_id=in\.\(([^)]*)\)/)?.[1] || '';
    assert.ok(filterIds.split(',').length <= 100, 'each request must include at most 100 unique report IDs');
  }
  assert.equal(rows.length, 3);
  calls.length = 0;
  assert.equal((await sandbox.readVouchers('company-id', 'store-id', [])).length, 0);
  assert.equal(calls.length, 0, 'an empty month must not read unrelated store history');
  const overview = api.slice(api.indexOf('async function overview('), api.indexOf('async function reportAcknowledge('));
  assert.match(overview, /const reports = rawReports\.filter\([\s\S]*?reportUploadVouchers\(companyId, storeId, reports\)/);
  assert.doesNotMatch(overview, /record_type=eq\.report&order=uploaded_at\.desc&limit=1000/);
  console.log('ZYSYR v547 monthly overview voucher scoping: store/report filters, bounded chunks, empty-period no-query passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
