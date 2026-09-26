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
const staff = { username: 'finance.test', password_hash: 'legacy-password', role: 'staff', position: '财务',
  store: '测试门店', active: true, employment_status: 'active' };
const rpcCalls = [];
const paths = [];
const timingLogs = [];
let gateAllowed = true;
let gateStatus = 200;
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

  const restored = await readLegacySession();
  assert.equal(restored.username, staff.username, 'a legacy session created within the 30-day window remains usable');
  const sessionRead = paths.filter(call => call.path.startsWith('zysyr_operations_sessions?select=')).at(-1).path;
  assert.match(sessionRead, /created_at=gt\./, 'legacy session lookup must enforce its absolute creation-age limit');
  sessionCreatedAt = new Date(Date.now() - 31 * 86400000).toISOString();
  await assert.rejects(readLegacySession(), /登录已过期/, 'an unexpired database row older than 30 days must be rejected');

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
  console.log('legacy login security passed: bounded HMAC attempts, append-only outcomes, 429 handling, 30-day session creation and read-time age limits');
})().catch(error => { console.error(error); process.exitCode = 1; });
