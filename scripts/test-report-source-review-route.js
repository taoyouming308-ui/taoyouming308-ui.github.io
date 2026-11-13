'use strict';
// Full HTTP handler + real source projection/workbook readers; synthetic sessions and I/O only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHash } = require('node:crypto');
const ExcelJS = require('exceljs'), JSZip = require('jszip');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const store = { id: id(1), company_id: id(2), name: 'Synthetic Store' };
const actor = { operations_role: 'finance', auth_account_id: id(3), auth_scope_type: 'company',
  auth_stores: [store.name], auth_store_records: [store], auth_capabilities: ['expense.create_submit'] };
const originalActor = JSON.stringify(actor);
(async () => {
  const { reportSourceReview } = await import('../supabase/functions/_shared/report-source-review.mjs');
  const book = new ExcelJS.Workbook();
  for (const name of ['7月', '8月 ', '9月']) {
    const sheet = book.addWorksheet(name);
    sheet.mergeCells('A1:C1'); sheet.getCell('A1').value = 'Synthetic source';
    sheet.getCell('A2').value = '支出'; sheet.getCell('B2').value = '支出类别';
    sheet.getCell('B3').value = '用品'; sheet.getCell('C3').value = { formula: '10+2.34', result: 12.34 };
    sheet.getCell('B4').value = '合计'; sheet.getCell('C4').value = { formula: 'SUM(C3:C3)', result: 12.34 };
  }
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  const archive = { request_id: id(5), bucket_id: 'zysyr-reports',
    object_path: `${store.company_id}/${store.id}/monthly-source/${id(5)}`,
    original_filename: 'synthetic.xlsx', size_bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), worksheet_names: ['7月', '8月 ', '9月'] };
  const batch = { id: id(6), import_type: 'petty_cash', source_filename: 'synthetic-petty.xlsx',
    source_sha256: 'b'.repeat(64), period_start: '2026-07-01', period_end: '2026-09-01', status: 'needs_review', imported_row_count: 0 };
  let month = '2026-08', calls = [], mode = '', authenticated = true;
  const sharedBuiltins = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, URL, Date };
  const monthlyContext = vm.createContext(sharedBuiltins);
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/monthly-source-archive.ts', 'utf8').replaceAll('export ', '')), monthlyContext);
  const env = vm.createContext({ ...sharedBuiltins, Request, Response, AbortSignal, crypto: webcrypto,
    ExcelJS, JSZip, reportSourceReview, monthlySourceWorksheetNames: monthlyContext.monthlySourceWorksheetNames,
    mockSession: actor, Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : 'synthetic-key' }, serve: fn => { env.handler = fn; } },
    fetch: async (url, opts = {}) => {
      const parsed = new URL(url), method = opts.method || 'GET', path = parsed.pathname;
      calls.push({ path, method, query: parsed.search, body: opts.body ? JSON.parse(opts.body) : null });
      if (path.startsWith('/storage/')) {
        assert.equal(method, 'GET');
        assert.equal(path, '/storage/v1/object/zysyr-reports/' + archive.object_path);
        if (mode === 'storage-failed') return new Response('{}', { status: 503 });
        return new Response(bytes);
      }
      if (path === '/rest/v1/rpc/zysyr_monthly_source_archive') {
        const body = JSON.parse(opts.body);
        assert.equal(method, 'POST'); assert.ok(['list', 'view'].includes(body.p_action), 'only read RPC actions');
        assert.equal(body.p_actor_user_id, actor.auth_account_id);
        assert.equal(body.p_company_id, store.company_id); assert.equal(body.p_store_id, store.id);
        if (mode === 'rpc-failed') return new Response('{}', { status: 503 });
        if (body.p_action === 'list') {
          assert.deepEqual(body.p_metadata, { month, offset: 0 });
          return Response.json({ current_selection: mode === 'missing' ? null : { id: id(4), source_request_id: id(5),
            company_id: store.company_id, store_id: store.id, period_month: month + '-01',
            worksheet_name: month === '2026-08' ? '8月 ' : Number(month.slice(5)) + '月', selection_version: 1 } });
        }
        assert.equal(body.p_request_id, id(5));
        return Response.json({ status: 'archived', request_id: id(5), archive });
      }
      assert.equal(method, 'GET', 'history may only read');
      assert.equal(parsed.searchParams.get('company_id'), 'eq.' + store.company_id);
      assert.equal(parsed.searchParams.get('store_id'), 'eq.' + store.id);
      if (path.endsWith('/zysyr_history_import_batches')) return Response.json([batch]);
      assert.equal(parsed.searchParams.get('import_batch_id'), 'eq.' + batch.id);
      if (path.endsWith('/zysyr_history_import_rows')) return Response.json([{ id: id(8), import_batch_id: batch.id,
        source_sheet: '08', source_row_number: 8, source_locator: '08!A8:H8', mapped_json: { period_month: month + '-01' },
        raw_json: { cells: [{ address: 'A8', value: month + '-04' }, { address: 'C8', value: 'Synthetic expense' }, { address: 'E8', value: 12.34 }] },
        corrected_json: null, review_status: 'pending', import_status: 'pending', validation_status: 'warning', validation_issues: [] }]);
      if (path.endsWith('/zysyr_history_import_evidence')) return Response.json([{ id: id(9), import_batch_id: batch.id,
        period_month: month + '-01', original_filename: 'synthetic.docx', sha256: 'c'.repeat(64) }]);
      assert.ok(['/zysyr_history_import_row_evidence', '/zysyr_history_import_events', '/zysyr_history_ledger_entries', '/zysyr_history_ledger_revisions'].some(suffix => path.endsWith(suffix)), path);
      return Response.json([]);
    },
  });
  for (const file of ['supabase/functions/_shared/staff-report-access.ts', 'supabase/functions/operations-api/index.ts']) {
    vm.runInContext(stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export ', '')), env);
  }
  env.hasSyntheticSession = () => authenticated;
  vm.runInContext('var originalRequireSession=requireSession; requireSession=async(payload,request)=>hasSyntheticSession()?mockSession:originalRequireSession(payload,request)', env);
  const post = async (extra = {}) => {
    const response = await env.handler(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify({ operation: 'report_source_review', store: store.name, month, kind: 'monthly', ...extra }) }));
    return { status: response.status, data: await response.json() };
  };
  for (month of ['2026-07', '2026-08', '2026-09']) {
    calls = [];
    const result = await post({ actor_user_id: id(99), company_id: id(99), store_id: id(99), source_request_id: id(99), role: 'admin' });
    assert.equal(result.status, 200); assert.equal(result.data.status, 'ready');
    assert.equal(result.data.source.worksheet_name, month === '2026-08' ? '8月 ' : Number(month.slice(5)) + '月');
    assert.equal(result.data.monthly.rows[2].cells[2].value, 12.34);
    assert.equal(result.data.financial_records_unchanged, true);
    assert.ok(calls.every(call => call.path.includes('/storage/') || call.path.endsWith('/rpc/zysyr_monthly_source_archive')));
  }
  month = '2026-08'; calls = [];
  let result = await post({ kind: 'expenses', import_batch_id: id(99) });
  assert.equal(result.status, 200); assert.equal(result.data.expenses[0].amount, 12.34);
  assert.equal(result.data.expenses[0].import_batch_id, batch.id); assert.equal(result.data.evidence[0].level, 'month');
  assert.ok(calls.some(call => call.path.endsWith('/zysyr_history_import_rows')));
  assert.ok(calls.every(call => call.method === 'GET' || call.path.endsWith('/rpc/zysyr_monthly_source_archive') && ['list', 'view'].includes(call.body.p_action)));
  for (const payload of [{ month: '2026-13' }, { kind: 'post' }, { store: 'Foreign' }]) {
    calls = []; result = await post(payload); assert.notEqual(result.status, 200); assert.equal(calls.length, 0);
  }
  for (const session of [{ ...actor, operations_role: 'shareholder' }, { ...actor, operations_role: 'employee' }, { ...actor, auth_capabilities: [] }]) {
    env.mockSession = session; calls = []; result = await post({ role: 'finance', auth_capabilities: ['expense.create_submit'] });
    // The existing generic capability/employee error mapper uses HTTP 400.
    assert.equal(result.status, 400); assert.match(result.data.error, /只有财务|员工账号只能/); assert.equal(calls.length, 0);
  }
  env.mockSession = actor; calls = [];
  result = await post({ employee_session_token: 'synthetic-employee' });
  assert.equal(result.status, 403); assert.equal(calls.length, 0, 'staff allowlist rejects before private reads');
  authenticated = false; result = await post(); assert.equal(result.status, 403); assert.equal(calls.length, 0); authenticated = true;
  mode = 'missing'; result = await post(); assert.equal(result.status, 200); assert.equal(result.data.status, 'missing');
  for (mode of ['rpc-failed', 'storage-failed']) { result = await post(); assert.notEqual(result.status, 200); assert.ok(result.data.error); }
  assert.equal(JSON.stringify(actor), originalActor);
  console.log('Report source HTTP route passed: full handler/real workbook projection, three exact sheets, scoped source/history reads, finance capability, denied staff/nonfinance/foreign scope, safe failures and no write operations. Synthetic auth/network only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
