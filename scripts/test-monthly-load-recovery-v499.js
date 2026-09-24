/* Regression for a 450-cell original report; no production writes or credentials. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/operations-api/index.ts'), 'utf8');
const names = ['rest', 'publicRequestError', 'monthlyTraceRevisionsPath'];
const snippets = names.map(name => {
  const start = source.indexOf((name === 'rest' ? 'async ' : '') + 'function ' + name + '(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}).join('\n');
let calls = 0;
const sandbox = { Error, SUPABASE_URL: 'https://example.invalid', SERVICE_KEY: 'synthetic', fetch: async () => {
  calls++;
  throw new Error('SendRequest https://example.invalid/rest/v1/data?target_cell_id=in.(' + 'private-record,'.repeat(450) + ') http2 error');
} };
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(snippets), sandbox);
const ids = Array.from({ length: 450 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0'));
assert.ok(ids.join(',').length > 16000, 'fixture must reproduce the oversized query');
const query = sandbox.monthlyTraceRevisionsPath(ids[0], ids[1], ids[2]);
assert.ok(query.length < 600, 'query size must be independent of report cell count');
assert.ok(query.includes('company_id=eq.' + ids[0]) && query.includes('store_id=eq.' + ids[1]));
assert.ok(query.includes('cell.report_id=eq.' + ids[2]) && query.includes('zysyr_report_cells!inner(report_id)'));
assert.ok(!query.includes('target_cell_id=in.'));
const overview = source.slice(source.indexOf('async function overview('), source.indexOf('function latestMonthlyCellRevisionMap('));
assert.ok(overview.includes('restRowsAll(monthlyTraceRevisionsPath(companyId, storeId, reportId), 5000)'));
assert.ok(!overview.includes('target_cell_id=in.${cellFilter}'));
assert.equal(sandbox.publicRequestError(new Error('请填写本次金额修改原因')), '请填写本次金额修改原因');
assert.match(sandbox.publicRequestError(new Error(ids.join(','))), /暂时失败/);
assert.match(sandbox.publicRequestError(new Error('http2 error: private URL')), /暂时失败/);
(async () => {
  await assert.rejects(sandbox.rest('sensitive', { method: 'POST' }), error => {
    assert.ok(!/private-record|https:|SendRequest/.test(error.message));
    assert.match(error.message, /先核对保存结果/);
    return true;
  });
  assert.equal(calls, 1, 'a lost write response must never be blindly replayed');
  console.log('v499: 450-cell bounded FK query, company/store/report isolation, safe errors and no write replay passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
