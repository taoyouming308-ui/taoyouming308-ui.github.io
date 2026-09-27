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
  console.log('Daily electronic reader: finance-only, session store, bounded exact dates, reference-only and fail-closed replies passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
