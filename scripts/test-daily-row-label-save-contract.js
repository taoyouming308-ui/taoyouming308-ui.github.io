const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('operations-daily-review.js', 'utf8');
const page = fs.readFileSync('operations.html', 'utf8');
const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const functions = slice('  function context()', '  function sheetVersion(')
  + slice('  function sheetVersion(', '  function sourceBusy(')
  + slice('  async function checkBeforeWrite(', '  async function syncDailySheet(')
  + slice('  function reviewedValues(', '  async function refreshCalendar(');
const collect = page.match(/^  function collectDailySheetCells\([^\n]+/m)[0];
const saveMigration = fs.readFileSync('supabase/migrations/20260920110534_daily_review_explicit_blank.sql', 'utf8');
assert.match(saveMigration, /set row_label_source_method = 'manual'/, 'fixture matches canonical SQL save marker');
let assertions = 1;
function fixture({ lostReply = false, method = 'manual' } = {}) {
  const old = { draft: { id: 'synthetic-draft', report_date: '2026-03-17', edit_revision: 2,
    status: 'draft', template_code: 'synthetic-photo', source_voucher_id: 'synthetic-photo' },
    permissions: { write: true }, locked: false, attachments: [], cells: [
      { id: 'synthetic-number', section_code: 'stylist', row_key: 'synthetic-row', column_code: 'color',
        row_label: '匿名员工甲', row_label_source_method: 'codex_local_candidate', manual_override: true, corrected_numeric: 123.45 },
      { id: 'synthetic-blank', section_code: 'stylist', row_key: 'synthetic-row', column_code: 'perm',
        row_label: '匿名员工甲', row_label_source_method: 'codex_local_candidate', manual_override: true, corrected_numeric: null },
    ] };
  const state = { imports: { sheet: structuredClone(old), dirty: { 'synthetic-number': '150.500', 'synthetic-blank': '' },
    dirtyLabels: { 'synthetic-row': '匿名员工甲' } } };
  const input = (cell) => ({ type: 'number', value: cell.corrected_numeric == null ? '' : String(cell.corrected_numeric),
    dataset: { dailyCell: cell.id, section: cell.section_code, rowKey: cell.row_key, rowLabel: cell.row_label,
      columnCode: cell.column_code, columnLabel: cell.column_code, rowNumber: '3', columnNumber: '2', role: 'staff_value' } });
  const render = (sheet) => {
    const numbers = sheet.cells.map(input);
    const label = { type: 'text', value: sheet.cells[0].row_label,
      dataset: { rowLabelInput: 'synthetic-row', cellId: sheet.cells[0].id, section: 'stylist' } };
    return { numbers, label, querySelectorAll(selector) {
      if (selector === '.daily-grid-scroll') return [];
      if (selector === '[data-row-label-input]') return [label];
      return selector.includes('data-row-label-input') ? [...numbers, label] : numbers;
    } };
  };
  let root = render(old); root.numbers[0].value = '150.500';
  let server = structuredClone(old), writes = 0, reads = 0;
  const sandbox = { state, JSON, Number, String, Object, Array, Map,
    quietRefresh: false, syncMessage: '', currentStore: () => 'synthetic-store',
    grid: () => root, dailySheetDirtyCount: () => Object.keys(state.imports.dirty).length + Object.keys(state.imports.dirtyLabels).length,
    document: { createElement() { return { set innerHTML(_v) { this.paper = render(state.imports.sheet); },
      querySelectorAll(selector) { return this.paper.querySelectorAll(selector); } }; } },
    window: { scrollX: 0, scrollY: 0, scrollTo() {} },
    dailyPaperSheet: () => 'synthetic-paper', renderDailySheetDetail: () => { root = render(state.imports.sheet); }, notice() {},
    api: async (operation, payload) => {
      if (operation === 'daily_sheet_read') { reads++; return structuredClone(server); }
      assert.equal(operation, 'daily_sheet_save', 'test never calls posting');
      assert.equal(payload.expected_revision, server.draft.edit_revision, 'write uses latest checked revision');
      writes++; server.draft.edit_revision++;
      for (const edit of payload.cells) {
        if (!Object.hasOwn(edit, 'value')) {
          for (const cell of server.cells) { cell.row_label = edit.row_label.trim(); cell.row_label_source_method = method; }
        } else {
          const cell = server.cells.find(c => c.id === edit.id);
          cell.corrected_numeric = edit.value == null ? null : Number(edit.value); cell.manual_override = true;
        }
      }
      if (lostReply) throw Error('synthetic committed reply lost');
      return structuredClone(server);
    },
  };
  vm.createContext(sandbox); vm.runInContext(functions + collect, sandbox);
  return { sandbox, state, context: sandbox.context(), get writes() { return writes; }, get reads() { return reads; },
    setServer(update) { update(server); }, get root() { return root; } };
}
async function savedAndRecovered(lostReply) {
  const f = fixture({ lostReply });
  await f.sandbox.persistDraft(f.context, 'synthetic manual review');
  assert.equal(f.writes, 1); assert.equal(f.context.revision, 3); assert.equal(f.sandbox.dailySheetDirtyCount(), 0);
  assert.equal(f.state.imports.sheet.cells[0].corrected_numeric, 150.5);
  assert.equal(f.state.imports.sheet.cells[1].corrected_numeric, null);
  assert.equal(f.state.imports.sheet.cells[1].manual_override, true);
  assert.ok(f.state.imports.sheet.cells.every(c => c.row_label_source_method === 'manual'));
  assert.equal(f.reads, lostReply ? 2 : 1); assertions += 8;
  await f.sandbox.persistDraft(f.context, 'synthetic repeated save');
  await f.sandbox.checkBeforeWrite(f.context);
  assert.equal(f.writes, 1); assert.equal(f.context.revision, 3); assertions += 2;
}
(async () => {
  await savedAndRecovered(false); await savedAndRecovered(true);
  // A newer matching committed save is adopted before another write.
  const recovered = fixture();
  recovered.setServer(s => { s.draft.edit_revision = 3; s.cells[0].corrected_numeric = 150.5;
    s.cells.forEach(c => { c.row_label_source_method = 'manual'; }); });
  await recovered.sandbox.persistDraft(recovered.context, 'synthetic recovery');
  assert.equal(recovered.writes, 0); assert.equal(recovered.context.revision, 3); assertions += 2;
  for (const mutation of [s => { s.cells[0].corrected_numeric = 999; },
    s => { s.cells[0].row_label = '其他匿名行'; },
    s => { s.cells.forEach(c => { c.row_label_source_method = 'codex_local_candidate'; }); },
    s => { s.permissions.write = false; }, s => { s.locked = true; }, s => { s.draft.status = 'confirmed'; }]) {
    const f = fixture();
    f.setServer(s => { s.draft.edit_revision = 3; s.cells[0].corrected_numeric = 150.5;
      s.cells.forEach(c => { c.row_label_source_method = 'manual'; }); mutation(s); });
    await assert.rejects(f.sandbox.checkBeforeWrite(f.context));
    assert.equal(f.writes, 0); assert.equal(f.context.revision, 2); assert.equal(f.sandbox.dailySheetDirtyCount(), 3);
    assertions += 4;
  }
  assert.ok(!source.includes("row_label_source_method === 'manual_entry'")); assertions++;
  console.log(JSON.stringify({ assertions, normal_response: true, lost_response_recovery: true,
    continuous_save_prepost_check: true, real_conflicts_preserved: true, posting_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
