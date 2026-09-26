#!/usr/bin/env node
// Exercises the compatibility login against synthetic REST/RPC responses.
// No production network, accounts, secrets, or sessions are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8')
  .replace(/^import .*;\n/gm, '');
const staff = { id: 1001, username: 'finance.test', password_hash: 'legacy-password', role: 'staff', position: '财务',
  store: '测试门店', active: true, employment_status: 'active' };
const mappedEmployee = { company_id: '11111111-1111-4111-8111-111111111111', target_id: '22222222-2222-4222-8222-222222222222' };
const rpcCalls = [];
const paths = [];
const timingLogs = [];
let gateAllowed = true;
let gateStatus = 200;
let mappingRows = [];
let accountRows = [];
let mappingReadStatus = 200;
let accountReadStatus = 200;
let sessionCreatedAt = new Date(Date.now() - 29 * 86400000).toISOString();
const sessionExpiry = '2036-01-01T00:00:00.000Z';
const context = vm.createContext({
  console: { ...console, info: line => timingLogs.push(JSON.parse(line)) }, Request, Response, TextEncoder, crypto: webcrypto, Date, performance,
  Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : 'synthetic-service-key' },
    serve: handler => { context.handler = handler; } },
  fetch: async (url, init = {}) => {
    const path = String(url).split('/rest/v1/')[1];
    const method = init.method || 'GET';
    paths.push({ method, path });
    if (path === 'rpc/zysyr_begin_auth_migration') {
      const args = JSON.parse(init.body); rpcCalls.push({ method, path, args });
      return new Response(JSON.stringify({ allowed: gateAllowed, retry_after_seconds: gateAllowed ? null : 900 }), { status: gateStatus });
    }
    if (path === 'rpc/zysyr_record_auth_migration_result') {
      const args = JSON.parse(init.body); rpcCalls.push({ method, path, args });
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('zysyr_legacy_id_map?')) {
      return new Response(JSON.stringify(mappingRows), { status: mappingReadStatus });
    }
    if (path.startsWith('zysyr_user_accounts?')) {
      return new Response(JSON.stringify(accountRows.filter(row => ['active', 'suspended', 'disabled'].includes(row.status))), { status: accountReadStatus });
    }
    if (path.startsWith('staff?')) return new Response(JSON.stringify([staff]), { status: 200 });
    if (path.startsWith('zysyr_operations_sessions?select=')) {
      const cutoff = new URLSearchParams(path.split('?')[1]).get('created_at')?.slice(3);
      const inAgeWindow = cutoff && Date.parse(sessionCreatedAt) > Date.parse(cutoff);
      const rows = inAgeWindow ? [{ username: staff.username, role: staff.role, position: staff.position,
        store: staff.store, expires_at: sessionExpiry, created_at: sessionCreatedAt }] : [];
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (path.startsWith('zysyr_operations_sessions?token_hash=') && method === 'PATCH') return new Response(null, { status: 204 });
    if (path.startsWith('zysyr_operations_sessions?') && method === 'DELETE') return new Response(null, { status: 204 });
    if (path === 'zysyr_operations_sessions' && method === 'POST') {
      rpcCalls.push({ method, path, args: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected synthetic request ${method} ${path}`);
  },
});
vm.runInContext(stripTypeScriptTypes(source), context);

async function post(password = 'legacy-password') {
  return context.handler(new Request('https://synthetic.invalid/functions/v1/operations-api', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.17' },
    body: JSON.stringify({ operation: 'login', username: staff.username, password }),
  }));
}

async function readLegacySession() {
  return context.requireSession({ session_token: 'a'.repeat(72) }, new Request('https://synthetic.invalid/functions/v1/operations-api', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
}

(async () => {
  let response = await post();
  assert.equal(response.status, 200, 'a valid legacy credential remains usable during the rolling migration');
  const timing = timingLogs.at(-1);
  assert.deepEqual(Object.keys(timing).sort(), ['duration_ms', 'event', 'operation', 'status']);
  assert.equal(timing.event, 'operations_api_timing');
  assert.equal(timing.operation, 'login');
  assert.equal(timing.status, response.status);
  assert(Number.isFinite(timing.duration_ms) && timing.duration_ms >= 0);
  assert(!JSON.stringify(timing).includes(staff.username) && !JSON.stringify(timing).includes('legacy-password'),
    'timing diagnostics must not expose credentials or identity');
  const success = rpcCalls.find(call => call.path === 'rpc/zysyr_record_auth_migration_result');
  assert.equal(success.args.p_event_type, 'success');
  assert.equal(success.args.p_reason_code, 'legacy_credentials_verified');
  const gate = rpcCalls.find(call => call.path === 'rpc/zysyr_begin_auth_migration');
  assert.match(gate.args.p_identity_hash, /^[0-9a-f]{64}$/);
  assert.match(gate.args.p_client_hash, /^[0-9a-f]{64}$/);
  assert(!gate.args.p_identity_hash.includes(staff.username), 'audit fingerprints must not expose usernames');
  const session = rpcCalls.find(call => call.path === 'zysyr_operations_sessions');
  const days = (Date.parse(session.args.expires_at) - Date.now()) / 86400000;
  assert(days > 29.99 && days <= 30, 'only a new compatibility session is limited to 30 days');

  const legacySessionCount = () => rpcCalls.filter(call => call.path === 'zysyr_operations_sessions' && call.method === 'POST').length;
  const sessionCountBeforeTransitionCases = legacySessionCount();
  mappingRows = [mappedEmployee];
  accountRows = [];
  response = await post();
  assert.equal(response.status, 200, 'an exact legacy mapping without a V2 account remains usable during rollout');
  response = await post();
  assert.equal(response.status, 200, 'repeated legacy login remains available until the V2 account is assigned');
  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'active' }];
  const sessionCountBeforeMigratedLogin = legacySessionCount();
  response = await post();
  assert.equal(response.status, 400, 'a mapped staff identity with an active V2 account cannot open a legacy session');
  assert.equal(legacySessionCount(), sessionCountBeforeMigratedLogin, 'migrated identities must not receive a compatibility token');
  assert.equal(rpcCalls.filter(call => call.path === 'rpc/zysyr_record_auth_migration_result').at(-1).args.p_reason_code,
    'supabase_auth_required', 'the append-only audit records the legacy channel block without storing an identity');
  assert(paths.some(call => call.path.startsWith(`zysyr_legacy_id_map?`) && call.path.includes('source_key=eq.1001')),
    'the block must rely on the exact legacy staff primary-key mapping');

  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'invited' }];
  response = await post();
  assert.equal(response.status, 200, 'an invited V2 account does not interrupt the existing login before activation');
  for (const status of ['suspended', 'disabled']) {
    accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status }];
    const before = legacySessionCount();
    response = await post();
    assert.equal(response.status, 400, `a ${status} V2 account must not bypass V2 access control through legacy login`);
    assert.equal(legacySessionCount(), before, `${status} V2 accounts must not receive legacy sessions`);
  }
  assert.equal(legacySessionCount(), sessionCountBeforeTransitionCases + 3,
    'only unmigrated and still-invited accounts created compatibility sessions');

  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'active' }];
  accountReadStatus = 503;
  const beforeReadFailure = legacySessionCount();
  response = await post();
  assert.notEqual(response.status, 200, 'an unavailable V2-account check must fail closed');
  assert.equal(legacySessionCount(), beforeReadFailure, 'no legacy session may be created when migration state cannot be checked');
  accountReadStatus = 200;
  mappingReadStatus = 503;
  response = await post();
  assert.notEqual(response.status, 200, 'an unavailable identity-map check must fail closed');
  mappingReadStatus = 200;
  mappingRows = [{ ...mappedEmployee }, { ...mappedEmployee, target_id: '44444444-4444-4444-8444-444444444444' }];
  response = await post();
  assert.equal(response.status, 400, 'ambiguous legacy mappings must never receive a compatibility session');
  mappingRows = [];
  accountRows = [];

  const restored = await readLegacySession();
  assert.equal(restored.username, staff.username, 'a legacy session created within the 30-day window remains usable');
  const sessionRead = paths.filter(call => call.path.startsWith('zysyr_operations_sessions?select=')).at(-1).path;
  assert.match(sessionRead, /created_at=gt\./, 'legacy session lookup must enforce its absolute creation-age limit');
  sessionCreatedAt = new Date(Date.now() - 31 * 86400000).toISOString();
  await assert.rejects(readLegacySession(), /登录已过期/, 'an unexpired database row older than 30 days must be rejected');
  sessionCreatedAt = new Date(Date.now() - 29 * 86400000).toISOString();
  mappingRows = [mappedEmployee];
  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'active' }];
  await assert.rejects(readLegacySession(), /新的安全登录/, 'an already-issued legacy session must not survive V2 account assignment');
  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'invited' }];
  const invitedLegacySession = await readLegacySession();
  assert.equal(invitedLegacySession.username, staff.username, 'an unactivated invitation does not cut off the current login path');
  for (const status of ['suspended', 'disabled']) {
    accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status }];
    await assert.rejects(readLegacySession(), /新的安全登录/, `a ${status} V2 account must also block legacy-session fallback`);
  }
  mappingRows = [{ ...mappedEmployee }, { ...mappedEmployee, target_id: '44444444-4444-4444-8444-444444444444' }];
  await assert.rejects(readLegacySession(), /映射不唯一/, 'ambiguous identity mappings must fail closed for existing sessions');
  mappingRows = [mappedEmployee];
  accountRows = [{ id: '33333333-3333-4333-8333-333333333333', status: 'active' }];
  accountReadStatus = 503;
  await assert.rejects(readLegacySession(), /数据读取失败/, 'an unavailable account check must not restore an old session');
  accountReadStatus = 200;
  mappingReadStatus = 503;
  await assert.rejects(readLegacySession(), /数据读取失败/, 'an unavailable identity-map check must not restore an old session');
  mappingReadStatus = 200;
  mappingRows = [];
  accountRows = [];

  response = await post('wrong-password');
  assert.equal(response.status, 400);
  assert.equal(rpcCalls.filter(call => call.path === 'rpc/zysyr_record_auth_migration_result').at(-1).args.p_event_type, 'failure');

  const staffLookupsBeforeBlockedAttempt = paths.filter(call => call.path.startsWith('staff?')).length;
  gateAllowed = false;
  response = await post();
  assert.equal(response.status, 429, 'rate-limited legacy login returns an explicit 429');
  assert.equal(paths.filter(call => call.path.startsWith('staff?')).length, staffLookupsBeforeBlockedAttempt,
    'blocked attempts must be rejected before credential lookup');
  gateAllowed = true; gateStatus = 503;
  response = await post();
  assert.equal(response.status, 503, 'if the limiter/audit RPC is unavailable, no compatibility session may be issued');
  assert.equal(paths.filter(call => call.path.startsWith('staff?')).length, staffLookupsBeforeBlockedAttempt,
    'limiter failures must reject before credential lookup');
  console.log('legacy login security passed: bounded HMAC attempts, append-only outcomes, exact Auth-transition blocking, fail-closed migration checks, 30-day session creation and read-time age limits');
})().catch(error => { console.error(error); process.exitCode = 1; });
