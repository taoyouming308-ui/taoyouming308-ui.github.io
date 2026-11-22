// Extract the real operation with synthetic scope dependencies; no production calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const src = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = src.indexOf('async function dailyElectronicSources(');
const end = src.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start);
const calls = [];
let ok = true, receipt = { items: [], stage: 'source_only', formal_ledger_amount_changed: false };
const ctx = vm.createContext({ Date, Number, Array, JSON, Error, AbortSignal,
  cleanText: (v, n) => String(v ?? '').trim().slice(0, n),
  uuidValue: value => { if (value == null) return null; if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('invalid id'); return value; },
  requireFinanceCapability: (session, cap) => {
    if (session.role !== 'finance' || cap !== 'daily_report.write') throw new Error('denied');
  },
  selectedStoreInfo: async session => ({ company_id: 'company-session', id: session.store_id, name: '会话门店' }),
  rest: async (path, init) => { calls.push({ path, init }); return { ok, json: async () => receipt }; },
});
vm.runInContext(stripTypeScriptTypes(src.slice(start, end)), ctx);
const fillStart = src.indexOf('async function fillDailySheetBlanks(');
const fillEnd = src.indexOf('\n}', fillStart) + 2;
assert(fillStart >= 0 && fillEnd > fillStart);
vm.runInContext(stripTypeScriptTypes(src.slice(fillStart, fillEnd)), ctx);
const correctionStart = src.indexOf('async function dailyDraftSourceCorrection(');
const correctionEnd = src.indexOf('\n}', correctionStart) + 2;
assert(correctionStart >= 0 && correctionEnd > correctionStart);
vm.runInContext(stripTypeScriptTypes(src.slice(correctionStart, correctionEnd)), ctx);
(async () => {
  const session = { role: 'finance', store_id: 'scoped-store' };
  const valid = { start_date: '2026-01-01', end_date: '2026-01-31' };
  for (const role of ['staff', 'shareholder', 'admin', '']) {
    await assert.rejects(ctx.dailyElectronicSources(valid, { ...session, role }), /denied/);
  }
  for (const invalid of [ { start_date: '2026-02-30' }, { end_date: '2026-02-01' },
    { end_date: '2099-01-01' }, { start_date: '2025-12-31' }, { end_date: '2026-01-00' } ]) {
    await assert.rejects(ctx.dailyElectronicSources({ ...valid, ...invalid }, session));
  }
  assert.equal(calls.length, 0);
  const result = await ctx.dailyElectronicSources({ ...valid, company_id: 'other-company', store_id: 'other-store' }, session);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_company_id: 'company-session', p_store_id: 'scoped-store', p_date_from: valid.start_date, p_date_to: valid.end_date,
    p_source_scope: null, p_candidate_id: null,
  });
  assert.equal(calls[0].path, 'rpc/zysyr_read_daily_electronic_source');
  assert(calls[0].init.signal instanceof AbortSignal, 'reference reads must have a bounded timeout');
  assert.equal(result.readonly, true);
  assert.equal(result.automatic_posting_enabled, false);
  assert.equal(result.items.length, 0, 'empty source list is not a zero-money report');
  ok = false; await assert.rejects(ctx.dailyElectronicSources(valid, session), /暂不可用/);
  ok = true; receipt = { items: [], stage: 'posted', formal_ledger_amount_changed: true };
  await assert.rejects(ctx.dailyElectronicSources(valid, session), /回执无效/);
  assert.match(src, /operation === "daily_electronic_sources"/);
  const draftId = '00000000-0000-4000-8000-000000000001';
  const fillCalls = [];
  const fillPayload = { store: '会话门店', report_date: '2026-07-09', draft_id: draftId, expected_revision: 4 };
  const finance = { ...session, auth_account_id: 'session-actor' };
  ctx.validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  let fillResult = { status: 'draft_filled', draft_id: draftId, revision: 5, filled_value_count: 3,
    automatic_posting_enabled: false, formal_ledger_amount_changed: false };
  ctx.financeRpcSaved = async (endpoint, body) => {
    fillCalls.push(JSON.parse(JSON.stringify({ endpoint, body }))); return fillResult;
  };
  await assert.rejects(ctx.fillDailySheetBlanks(fillPayload, { ...finance, role: 'shareholder' }), /denied/);
  await assert.rejects(ctx.fillDailySheetBlanks({ ...fillPayload, store: '其他门店' }, finance), /门店/);
  for (const invalid of [{ report_date: '2026-02-30' }, { report_date: '2026-07-09extra' },
    { expected_revision: null }, { expected_revision: '4' }, { expected_revision: -1 }]) {
    await assert.rejects(ctx.fillDailySheetBlanks({ ...fillPayload, ...invalid }, finance), /日期或版本/);
  }
  assert.equal(fillCalls.length, 0);
  const filled = await ctx.fillDailySheetBlanks({ ...fillPayload, company_id: 'spoof', store_id: 'spoof', user_id: 'spoof' }, finance);
  assert.deepEqual(fillCalls[0], { endpoint: 'rpc/zysyr_fill_daily_sheet_blanks', body: {
    p_company_id: 'company-session', p_store_id: 'scoped-store', p_actor_user_id: 'session-actor',
    p_draft_id: draftId, p_day: '2026-07-09', p_expected_revision: 4 } });
  assert.equal(filled.filled_value_count, 3);
  fillResult = { ...fillResult, revision: 6 };
  await assert.rejects(ctx.fillDailySheetBlanks(fillPayload, finance), /回执未能核实/);
  fillResult = { status: 'source_unavailable_or_changed', automatic_posting_enabled: false };
  assert.equal((await ctx.fillDailySheetBlanks(fillPayload, finance)).filled_value_count, 0);
  assert.match(src, /operation === "daily_sheet_fill_blanks"/);
  const cellId = '00000000-0000-4000-8000-000000000002';
  const token = 'a'.repeat(64);
  let correctionResult = { status: 'preview', draft_id: draftId, revision: 4, source_token: token, items: [] };
  fillCalls.length = 0;
  ctx.financeRpcSaved = async (endpoint, body) => {
    fillCalls.push(JSON.parse(JSON.stringify({ endpoint, body }))); return correctionResult;
  };
  const correctionPayload = { ...fillPayload, source_token: token, selected_ids: [cellId],
    company_id: 'spoof', store_id: 'spoof', user_id: 'spoof', amount: 1, edits: [{ id: cellId, value: 1 }] };
  await assert.rejects(ctx.dailyDraftSourceCorrection(correctionPayload, { ...finance, role: 'shareholder' }, false), /denied/);
  await assert.rejects(ctx.dailyDraftSourceCorrection({ ...correctionPayload, store: '其他门店' }, finance, false), /门店/);
  for (const invalid of [{}, { confirmed: true, selected_ids: [cellId, cellId] }, { confirmed: true, source_token: 'bad' }])
    await assert.rejects(ctx.dailyDraftSourceCorrection({ ...correctionPayload, ...invalid }, finance, true));
  assert.equal(fillCalls.length, 0);
  assert.equal((await ctx.dailyDraftSourceCorrection(correctionPayload, finance, false)).source_token, token);
  const expected = { p_company_id: 'company-session', p_store_id: 'scoped-store', p_actor_user_id: 'session-actor',
    p_draft_id: draftId, p_day: '2026-07-09', p_expected_revision: 4 };
  assert.deepEqual(fillCalls[0], { endpoint: 'rpc/zysyr_correct_daily_draft_from_source',
    body: { ...expected, p_selected: null, p_source_token: null } });
  correctionResult = { status: 'saved', draft_id: draftId, revision: 5, changed_cells: 1, formal_ledger_amount_changed: false };
  assert.equal((await ctx.dailyDraftSourceCorrection({ ...correctionPayload, confirmed: true }, finance, true)).status, 'saved');
  assert.deepEqual(fillCalls[1].body, { ...expected, p_selected: [cellId], p_source_token: token });
  correctionResult = { ...correctionResult, formal_ledger_amount_changed: true };
  await assert.rejects(ctx.dailyDraftSourceCorrection({ ...correctionPayload, confirmed: true }, finance, true), /回执无法确认/);
  console.log('Daily electronic source: finance/store scoping, fill-only and selected-only correction contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
