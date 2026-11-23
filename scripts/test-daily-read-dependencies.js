'use strict';
// Synthetic latency barriers: test actual read functions, without credentials,
// network access, writes, timers or assumptions about machine speed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const company = 'company', store = 'store', id = 'draft', day = '2026-10-09';
const draft = { id, status: 'confirmed', report_date: day, validation_result: { valid: true, grand_total: 20 } };
function harness(names) {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const pending = [], reads = [];
  const gate = async (name, value) => {
    reads.push(name);
    if (names.includes(name)) { pending.push(name); await barrier; }
    return value;
  };
  const rows = {
    zysyr_daily_reports: [{ id: 'formal', report_date: day, status: 'approved', version: 1 }],
    zysyr_daily_sheet_drafts: [draft],
    zysyr_period_locks: [],
    zysyr_daily_sheet_cells: [{ id: 'cell', draft_id: id }],
    zysyr_daily_sheet_attachments: [{ id: 'link', draft_id: id, voucher_id: 'voucher' }],
    zysyr_voucher_attachments: [{ id: 'voucher', mime_type: 'image/jpeg', audit_status: 'approved' }],
    zysyr_daily_sheet_attachment_voids: [{ daily_sheet_attachment_id: 'link' }],
    zysyr_daily_report_lines: [{ daily_report_id: 'formal', line_type: 'income', amount: 20 }],
    zysyr_daily_attachment_orientation_revisions: [{ daily_sheet_attachment_id: 'link', degrees: 90 }],
    zysyr_daily_sheet_cell_changes: [{ cell_id: 'cell', changed_by_user_id: 'actor' }],
    zysyr_user_accounts: [{ id: 'actor', display_name: 'Synthetic' }],
  };
  const read = async path => {
    const table = path.split('?')[0];
    assert(Object.hasOwn(rows, table), 'unexpected read: ' + table);
    assert(path.includes('company_id=eq.' + company));
    if (!['zysyr_user_accounts', 'zysyr_period_locks'].includes(table)) assert(path.includes('store_id=eq.' + store));
    return gate(table, rows[table]);
  };
  const env = vm.createContext({
    cleanText: x => String(x ?? ''), selectedStoreInfo: async () => ({ company_id: company, id: store }),
    hasAuthCapability: () => true, parseMonth: () => day.slice(0, 7), dailySheetTotal: Number,
    uuidIn: ids => ids.join(','), restRows: read, restRowsAll: read,
    currentDailyValidations: (c, s, ids) => {
      assert.equal(c, company); assert.equal(s, store); assert.deepEqual(Array.from(ids), [id]);
      return gate('validation', { byDraft: new Map([[id, { valid: true }]]), unavailable: false });
    },
    VOUCHER_BUCKET: 'synthetic', signedStorageUrl: async () => 'synthetic-private-url',
    dailyAutofillView: (draft, cells) => ({ draft, cells }), effectiveCellValue: () => 20,
  });
  for (const [first, next] of [['dailySheetData','createDailySheetDraft'], ['dailySheetMonth','dailySheetRead']]) {
    vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('async function ' + first + '('),
      source.indexOf('\nasync function ' + next + '(', source.indexOf('async function ' + first + '(')))), env);
  }
  return { env, pending, reads, release, rows };
}
async function calendar() {
  const expected = ['validation','zysyr_daily_sheet_attachments','zysyr_daily_report_lines','zysyr_daily_sheet_cells'];
  const h = harness(expected);
  const result = h.env.dailySheetMonth({}, {});
  await new Promise(setImmediate);
  assert.deepEqual(h.pending.slice().sort(), expected.slice().sort(), 'all four independent scoped reads start without waiting on each other');
  assert(!h.reads.includes('zysyr_voucher_attachments'), 'voucher rows require link IDs first');
  h.release();
  const data = await result;
  assert.equal(data.days[0].grand_total, 20);
  assert.equal(data.days[0].approved_original_count, 0, 'voided voucher cannot become effective');
  assert.equal(data.days[0].historical_validation_status, 'current_valid');
  assert.equal(data.days[0].recognition_saved, true);
  const denied = harness([]); denied.env.hasAuthCapability = () => false;
  await assert.rejects(denied.env.dailySheetMonth({}, {}), /没有查看/);
  assert.deepEqual(denied.reads, []);
  const broken = harness([]); delete broken.rows.zysyr_daily_report_lines;
  await assert.rejects(broken.env.dailySheetMonth({}, {}), /unexpected read/, 'read errors must not become empty totals');
}
async function detail() {
  const expected = ['validation','zysyr_voucher_attachments','zysyr_daily_attachment_orientation_revisions','zysyr_user_accounts'];
  const h = harness(expected);
  const result = h.env.dailySheetData(company, store, id, true);
  await new Promise(setImmediate);
  assert.deepEqual(h.pending.slice().sort(), expected.slice().sort(), 'metadata, history-name and current review reads do not wait on each other');
  h.release();
  const data = await result;
  assert.equal(data.current_validation_review.status, 'current_valid');
  assert.equal(data.cells[0].effective_numeric, 20);
  assert.equal(data.attachments[0].display_rotation_degrees, 90);
  assert.equal(data.original_image_url, null);
  assert.equal(data.history[0].changed_by_name, 'Synthetic');
  const hidden = harness([]);
  const limited = await hidden.env.dailySheetData(company, store, id, false);
  assert(!Object.hasOwn(limited, 'history')); assert(!hidden.reads.includes('zysyr_user_accounts'));
  assert(!hidden.reads.includes('zysyr_daily_sheet_cell_changes'));
  const missing = harness([]); missing.rows.zysyr_daily_sheet_drafts = [];
  await assert.rejects(missing.env.dailySheetData(company, store, id, true), /不存在或不属于/);
  assert.deepEqual(missing.reads, ['zysyr_daily_sheet_drafts']);
}
Promise.all([calendar(), detail()]).then(() => console.log('Daily calendar/detail bounded read dependency, scope and preservation checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
