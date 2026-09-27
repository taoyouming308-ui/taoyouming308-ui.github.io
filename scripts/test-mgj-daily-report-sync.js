// Synthetic signature and handler tests; never contacts Meiguanjia or production Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
const keys = generateKeyPairSync('ed25519');
const pub = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
let handler, calls = [], dbStatus = 200, failedTransport = false;
const receipt = { snapshot_id: '00000000-0000-4000-8000-000000000001', candidate_id: '00000000-0000-4000-8000-000000000002',
  source_sha256: 'a'.repeat(64), version: 1, status: 'needs_review', stage: 'source_only', inserted: true,
  latest: true, watermark_advanced: true, source_scope: 'projects_daily_summary', scope_verified: false, formal_ledger_amount_changed: false };
const src = fs.readFileSync('supabase/functions/mgj-daily-report-sync/index.ts', 'utf8')
  .replace(/const PUBLIC_KEY_BASE64 = "[^"]+";/, `const PUBLIC_KEY_BASE64 = "${pub}";`);
const ctx = vm.createContext({ Request, Response, Uint8Array, TextEncoder, TextDecoder, Date, Object, JSON,
  Number, Array, Error, AbortSignal, atob, crypto: webcrypto,
  Deno: { env: { get: k => k === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-service-secret' }, serve: f => { handler = f; } },
  fetch: async (url, init) => { calls.push({ url, init }); if (failedTransport) throw new Error('PRIVATE_ERROR');
    return new Response(JSON.stringify(receipt), { status: dbStatus }); },
});
vm.runInContext(stripTypeScriptTypes(src), ctx);
const date = '2026-01-01', period = `${Date.parse(date)}_${Date.parse(date)}`;
const valid = () => ({ operation: 'source_append', shop: '自由手艺人', date, source_scope: 'projects_daily_summary', fetched_at: new Date().toISOString(),
  source: { shop_id: '1009951', business_date: date,
    query: { parentShopId: 1103470, shopId: '1103470', shopIds: ['1009951'], period, incomeType: ['1'], depcode: '-1' },
    content: { head: [], headTop: [], data: [[date, ...Array(23).fill('')]], columns: [], config: {} } } });
async function send(payload, { unsigned = false, domain = 'mgj-daily-report-sync\n', old = false, bodyOverride } = {}) {
  const body = bodyOverride ?? JSON.stringify(payload), ts = String(Math.floor(Date.now() / 1000) - (old ? 300 : 0));
  const headers = unsigned ? {} : { 'x-daily-report-sync-ts': ts,
    'x-daily-report-sync-signature': sign(null, Buffer.from(domain + ts + '.' + body), keys.privateKey).toString('base64url') };
  return handler(new Request('https://fixture.invalid', { method: 'POST', body, headers }));
}
(async () => {
  for (const opts of [{ unsigned: true }, { old: true }, { domain: 'mgj-customer-sync\n' }, { domain: 'mgj-booking-sync\n' }]) {
    assert.equal((await send(valid(), opts)).status, 401);
  }
  assert.equal(calls.length, 0);
  const bad = [];
  for (const change of [{ shop: '其他店' }, { shop: '__proto__' }, { date: '2026-02-30' }, { date: '2025-12-31' },
    { date: '2099-01-01' }, { operation: 'confirm' }, { table: 'zysyr_daily_reports' }, { source_scope: 'project_detail' },
    { source_scope: '__proto__' }, { fetched_at: '2026-01-01T00:00:00Z' }]) bad.push({ ...valid(), ...change });
  let p = valid(); p.source.shop_id = '1837032'; bad.push(p);
  p = valid(); p.source.query.shopIds = ['1837032']; bad.push(p);
  p = valid(); p.source.query.incomeType = ['1', '2', '3', '4', '5']; bad.push(p);
  p = valid(); p.source.query.period = '0_0'; bad.push(p);
  p = valid(); p.source.candidates = []; bad.push(p);
  p = valid(); p.source.content.data = []; bad.push(p);
  p = valid(); p.source.content.data[0][0] = '2026-01-02'; bad.push(p);
  for (const payload of bad) assert.equal((await send(payload)).status, 400);
  assert.equal(calls.length, 0, 'invalid signed scope cannot reach DB');
  assert.equal((await send(valid(), { bodyOverride: ' '.repeat(65537) })).status, 413);
  assert.equal((await handler(new Request('https://fixture.invalid'))).status, 405);
  assert.equal((await send(valid())).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fixture.invalid/rest/v1/rpc/zysyr_ingest_daily_electronic_source');
  const params = JSON.parse(calls[0].init.body);
  assert.equal(params.p_company_id, '02463a53-dfdb-4291-b04d-dd1d85f9d998');
  assert.equal(params.p_store_id, 'ea7e281f-a254-4664-bb03-cf1acf48d79d');
  assert.equal(params.p_source_scope, 'projects_daily_summary');
  dbStatus = 409;
  let response = await send(valid()); assert.equal(response.status, 409);
  assert.equal((await response.json()).outcome, 'unconfirmed');
  dbStatus = 200; receipt.formal_ledger_amount_changed = true;
  assert.equal((await send(valid())).status, 502);
  receipt.formal_ledger_amount_changed = false; failedTransport = true;
  response = await send(valid()); assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'request_failed', outcome: 'unconfirmed' });
  assert(calls.every(c => c.init.method === 'POST' && c.url.endsWith('/rpc/zysyr_ingest_daily_electronic_source')));
  console.log('Daily electronic source writer: domain separation, scope, bounded body, one RPC, no posting and uncertain-write receipts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
