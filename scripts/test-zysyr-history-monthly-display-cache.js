'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = api.indexOf('const HISTORY_MONTHLY_DISPLAY_CACHE_LIMIT =');
const end = api.indexOf('\nasync function historicalMonthlyReport(', start);
assert(start >= 0 && end > start, 'historical monthly display cache helper must exist');
const helperSource = api.slice(start, end);
const calls = { fetch: 0, parse: 0 };
const sandbox = {
  cleanText: (value, limit = 2000) => String(value ?? '').trim().slice(0, limit),
  SUPABASE_URL: 'https://example.supabase.co',
  SERVICE_KEY: 'test-only',
  storagePath: value => encodeURIComponent(value),
  fetch: async url => {
    calls.fetch += 1;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
  },
  workbookDisplay: async (bytes, type, store, sheet) => {
    calls.parse += 1;
    return { type, store, sheet, values: [[new TextDecoder().decode(bytes)]], cells: [{ amount: 1 }] };
  },
};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(`${helperSource}\nthis.readDisplay = historicalMonthlyDisplay;`), sandbox);

(async () => {
  const hash = 'a'.repeat(64);
  const batch = { source_sha256: hash, source_bucket_id: 'private-reports', source_object_path: 'company/store/source.xlsx' };
  const first = await sandbox.readDisplay('company-1', 'store-1', batch, 'Store One', '2026-01');
  first.values[0][0] = 'mutated by the downstream ledger overlay';
  const second = await sandbox.readDisplay('company-1', 'store-1', batch, 'Store One', '2026-01');
  assert.equal(calls.fetch, 1, 'same immutable source identity should download only once');
  assert.equal(calls.parse, 1, 'same immutable source identity should parse only once');
  assert.notEqual(second.values[0][0], first.values[0][0], 'cache hits must return a clone, not shared mutable data');

  await sandbox.readDisplay('company-2', 'store-1', batch, 'Store One', '2026-01');
  await sandbox.readDisplay('company-1', 'store-2', batch, 'Store One', '2026-01');
  await sandbox.readDisplay('company-1', 'store-1', batch, 'Store One renamed', '2026-01');
  assert.equal(calls.fetch, 4, 'cache identity must isolate company, store and display context');

  // Cache is bounded to two entries; the least recently used entry is evicted.
  await sandbox.readDisplay('company-3', 'store-3', batch, 'Store Three', '2026-01');
  const afterEviction = calls.fetch;
  await sandbox.readDisplay('company-1', 'store-1', batch, 'Store One', '2026-01');
  assert.equal(calls.fetch, afterEviction + 1, 'least-recently-used entry should be evicted at the configured bound');

  await sandbox.readDisplay('company-1', 'store-1', { ...batch, source_sha256: 'invalid' }, 'Store One', '2026-01');
  const invalidHashFetchCount = calls.fetch;
  await sandbox.readDisplay('company-1', 'store-1', { ...batch, source_sha256: 'invalid' }, 'Store One', '2026-01');
  assert.equal(calls.fetch, invalidHashFetchCount + 1, 'malformed source identities must bypass cache');

  const report = api.slice(api.indexOf('async function historicalMonthlyReport('), api.indexOf('\nasync function overview(', api.indexOf('async function historicalMonthlyReport(')));
  assert.match(report, /historicalMonthlyDisplay\(companyId, storeId, batch, storeName, sheetName\)/,
    'historical report must pass tenant and original display identity into cache');
  assert.match(report, /const entryByAddress = new Map\(entries\.map/,
    'mutable ledger entries must still overlay the original source per request');
  assert.match(report, /historyEvidenceForEntries\(companyId, storeId, entries\)/,
    'evidence must continue to be read per request');
  console.log('Historical monthly original-display cache: tenant-scoped identity, clone isolation, bounded LRU, malformed-hash bypass and fresh ledger/evidence overlays passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
