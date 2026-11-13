'use strict';
// Local synthetic source projection. No server, live credentials or financial writes.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  const { reportSourceReview } = await import('../supabase/functions/_shared/report-source-review.mjs');
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('8月 ');
  sheet.mergeCells('A1:C1'); sheet.getCell('A1').value = 'Synthetic source';
  sheet.getCell('A2').value = '支出'; sheet.getCell('B2').value = '支出类别';
  sheet.getCell('B3').value = '用品'; sheet.getCell('C3').value = { formula: '10+2.34', result: 12.34 };
  sheet.getCell('B4').value = '未填写';
  sheet.getCell('C4').numFmt = '0.00'; // Serialized empty self-closing cell must not consume a later formula.
  sheet.getCell('B5').value = '明确零'; sheet.getCell('C5').value = { formula: '0+0', result: 0 };
  sheet.getCell('B6').value = '合计'; sheet.getCell('C6').value = { formula: 'SUM(C3:C5)', result: 12.34 };
  const bytes = new Uint8Array(await book.xlsx.writeBuffer()), store = { id: id(1), company_id: id(2) };
  const session = { auth_account_id: id(3), role: 'finance' };
  const selection = { id: id(4), source_request_id: id(5), worksheet_name: '8月 ', selection_version: 1,
    company_id: store.company_id, store_id: store.id, period_month: '2026-08-01' };
  const archive = { request_id: id(5), bucket_id: 'zysyr-reports', object_path: `${id(2)}/${id(1)}/monthly-source/source.xlsx`,
    original_filename: 'synthetic.xlsx', size_bytes: bytes.length, sha256: hash(bytes), worksheet_names: ['8月 '] };
  const pettyBatch = { id: id(6), import_type: 'petty_cash', source_filename: 'synthetic-petty.xlsx',
    source_sha256: 'b'.repeat(64), period_start: '2026-07-01', period_end: '2026-09-01', status: 'needs_review', imported_row_count: 0 };
  const monthBatch = { ...pettyBatch, id: id(7), import_type: 'monthly_profit_loss', source_filename: 'old.xlsx', source_sha256: 'c'.repeat(64) };
  const pettyRow = { id: id(8), import_batch_id: id(6), source_sheet: '08', source_row_number: 8,
    source_locator: '08!A8:H8', mapped_json: { period_month: '2026-08-01', amount: 999 }, corrected_json: { amount: 888 },
    raw_json: { cells: [{ address: 'A8', value: '2026-08-04' }, { address: 'B8', value: '8503' },
      { address: 'C8', value: 'Source item' }, { address: 'E8', value: 12.34, formula: '10+2.34' }, { address: 'F8', value: '用品' }] },
    review_status: 'pending', import_status: 'pending', validation_status: 'warning', validation_issues: [{ code: 'sequence_unusual' }] };
  let mode = '', calls = [], lists = 0;
  const deps = {
    requireFinance: s => { if (s.role !== 'finance') throw Error('finance required'); },
    selectedStore: async (s, payload) => { assert.deepEqual(payload, { store: 'Synthetic' }); return store; },
    archiveRpc: async args => {
      calls.push(args); assert.equal(args.p_actor_user_id, session.auth_account_id);
      assert.equal(args.p_company_id, store.company_id); assert.equal(args.p_store_id, store.id);
      assert.ok(['list', 'view'].includes(args.p_action));
      if (args.p_action === 'list') {
        lists++;
        return { current_selection: mode === 'missing' ? null : { ...selection,
          ...(mode === 'scope' ? { store_id: id(99) } : {}),
          ...(mode === 'sheet' ? { worksheet_name: '8月' } : {}),
          ...(mode === 'race' && lists > 1 ? { id: id(99) } : {}) } };
      }
      return { status: 'archived', request_id: id(5), archive: { ...archive, ...(mode === 'hash' ? { sha256: 'a'.repeat(64) } : {}) } };
    },
    object: async path => { assert.equal(path, archive.object_path); return bytes; },
    hash: async data => hash(data), validateWorkbook: async () => ['8月 '], loadZip: data => JSZip.loadAsync(data),
    loadWorkbook: async data => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(data); return wb; },
    historyRead: async payload => {
      assert.equal(payload.store, 'Synthetic');
      const batch = payload.import_batch_id || id(6), rows = batch === id(6) ? [structuredClone(pettyRow)] : [];
      if (mode === 'date' && rows.length) rows[0].raw_json.cells[0].value = '2026-09-04';
      if (mode === 'inflow' && rows.length) {
        rows[0].raw_json.cells.find(cell => cell.address === 'E8').value = 0;
        rows[0].raw_json.cells.push({ address: 'D8', value: 123 });
      }
      const batches = [pettyBatch, monthBatch];
      if (mode === 'conflict') batches.push({ ...pettyBatch, id: id(10) });
      return { batches, selected_batch_id: batch, rows,
        evidence: [{ id: id(batch === id(6) ? 11 : 12), import_batch_id: batch,
          period_month: '2026-08-01', original_filename: 'synthetic.docx', sha256: 'd'.repeat(64) }] };
    },
  };
  const read = (kind = 'monthly', extra = {}, who = session) => { lists = 0; return reportSourceReview({ kind, month: '2026-08', store: 'Synthetic', ...extra }, who, deps); };
  let result = await read();
  assert.equal(result.status, 'ready'); assert.equal(result.source.worksheet_name, '8月 ');
  assert.equal(result.monthly.rows[0].cells.length, 1, 'merged values appear only at master');
  assert.equal(result.monthly.rows[2].cells[2].formula, '10+2.34'); assert.equal(result.monthly.rows[2].cells[2].value, 12.34);
  assert.equal(result.monthly.rows[3].cells[2].value, null, 'blank remains unknown');
  assert.equal(result.monthly.rows[4].cells[2].value, 0, 'cached formula zero remains zero');
  assert.equal(result.monthly.expense_rows.length, 3); assert.equal(result.monthly.formulas_recalculated, false);
  result = await read('expenses', { actor_user_id: id(99), source_request_id: id(99), store_id: id(99) });
  assert.equal(result.expenses[0].amount, 12.34, 'source raw value outranks mapped and corrected values in source-only view');
  assert.equal(result.expenses[0].voucher_number, '8503'); assert.equal(result.expenses[0].corrected_value_present, true);
  assert.equal(result.expenses[0].review_status, 'pending'); assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every(item => item.level === 'month'));
  assert.equal(result.evidence.find(item => item.import_type === 'monthly_profit_loss').matches_current_monthly_source, false);
  assert.equal(result.financial_records_unchanged, true);
  mode = 'inflow'; result = await read('expenses');
  assert.equal(result.expenses[0].direction, 'inflow'); assert.equal(result.expenses[0].amount, 123);
  assert.equal(result.expenses[0].outflow, 0); assert.equal(result.expenses[0].inflow, 123);
  for (const [name, message] of [['scope', /门店/], ['sheet', /工作表/], ['race', /已变化/], ['hash', /字节/], ['date', /日期/]]) {
    mode = name; await assert.rejects(read(name === 'date' ? 'expenses' : 'monthly'), message);
  }
  mode = 'missing'; assert.equal((await read()).status, 'missing');
  mode = 'conflict'; result = await read('expenses'); assert.equal(result.status, 'conflict'); assert.equal(result.expenses, undefined);
  mode = ''; await assert.rejects(read('monthly', { month: '2026-13' }), /有效月份/);
  const before = calls.length;
  await assert.rejects(read('monthly', {}, { role: 'shareholder' }), /finance required/);
  assert.equal(calls.length, before, 'unauthorized request reads no private source');
  assert.ok(calls.every(call => ['list', 'view'].includes(call.p_action)), 'read RPCs only');
  console.log('Report source review passed: exact selected sheet, raw values/formulas/blank/zero, merged masters, source integrity, scope/race, month-only evidence, conflicts and no write operations (synthetic).');
})().catch(error => { console.error(error); process.exitCode = 1; });
