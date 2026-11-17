// Runs the actual App read/identity functions with synthetic promises only.
// No browser profile, real account, network request, or business write is used.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'perm-app.html'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'actual App function boundaries exist');
  return source.slice(a, b);
}
const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function readHarness({ abort = true } = {}) {
  let now = 0, next = 1;
  const timers = new Map(), requests = [];
  const context = {
    window: {}, EMPLOYEE_BOOKINGS_ENDPOINT: 'https://synthetic.invalid/employee', SUPABASE_KEY: 'synthetic-public',
    AbortController: abort ? AbortController : undefined,
    setTimeout(fn, ms) { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { const item = deferred(); requests.push({ url, options, ...item }); return item.promise; },
  };
  vm.createContext(context);
  vm.runInContext(slice('  function employeeReadJson(', '  EmployeeReports.init('), context);
  return {
    context, requests, timers,
    tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}

async function readTests() {
  for (const abort of [true, false]) {
    const h = readHarness({ abort });
    let adopted = 0;
    const result = h.context.employeeReadJson('https://synthetic.invalid/read', {}, 15000);
    result.then(() => adopted++, () => {});
    await flush();
    assert.equal(h.requests.length, 1);
    h.tick(15000);
    await assert.rejects(result, error => error.code === 'READ_TIMEOUT' && error.status === 0);
    assert.equal(h.timers.size, 0);
    if (abort) assert.equal(h.requests[0].options.signal.aborted, true);
    // A transport that ignores AbortSignal can still finish later. It must not
    // turn the already timed-out read into success.
    h.requests[0].resolve({ ok: true, status: 200, json: () => Promise.resolve({ late: true }) });
    await flush(); assert.equal(adopted, 0);
  }
  {
    const h = readHarness(), body = deferred();
    const result = h.context.employeeReadJson('https://synthetic.invalid/body', {}, 15000);
    result.catch(() => {});
    await flush();
    h.requests[0].resolve({ ok: true, status: 200, json: () => body.promise });
    await flush(); h.tick(15000);
    await assert.rejects(result, error => error.code === 'READ_TIMEOUT');
    assert.equal(h.requests[0].options.signal.aborted, true);
    body.resolve({ lateBody: true }); await flush(); assert.equal(h.timers.size, 0);
  }
  {
    const h = readHarness(), external = { aborted: false, added: 0, removed: 0,
      addEventListener() { this.added++; }, removeEventListener() { this.removed++; } };
    const result = h.context.employeeReadJson('https://synthetic.invalid/success', { signal: external }, 15000);
    await flush();
    h.requests[0].resolve({ ok: true, status: 200, json: () => Promise.resolve({ rows: [] }) });
    assert.deepEqual(await result, { rows: [] });
    assert.equal(h.timers.size, 0); assert.equal(external.added, 1); assert.equal(external.removed, 1);
    assert.equal(h.requests[0].options.signal.aborted, false);
  }
  {
    const h = readHarness(), result = h.context.employeeReadJson('https://synthetic.invalid/denied', {}, 15000);
    await flush(); h.requests[0].resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: '没有此操作权限', code: 'SCOPE_DENIED' }) });
    await assert.rejects(result, error => error.status === 403 && error.code === 'SCOPE_DENIED');
    assert.equal(h.timers.size, 0);
  }
  for (const operation of ['session', 'today_bookings']) {
    const h = readHarness(), result = h.context.employeeBookingsRequest(operation, { session_token: 'synthetic' });
    result.catch(() => {}); await flush();
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 1);
    assert.equal(JSON.parse(h.requests[0].options.body).operation, operation);
    h.tick(15000); await assert.rejects(result, error => error.code === 'READ_TIMEOUT');
  }
  for (const operation of ['login', 'logout', 'customer_design_save']) {
    const h = readHarness(), result = h.context.employeeBookingsRequest(operation, { sample: 'unchanged' });
    await flush(); assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0, 'writes have no new cancellation/replay');
    h.tick(60000); assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.signal, undefined);
    assert.equal(JSON.parse(h.requests[0].options.body).sample, 'unchanged');
    h.requests[0].resolve({ ok: true, status: 200, json: () => Promise.resolve({ accepted: true }) });
    assert.deepEqual(await result, { accepted: true });
  }
}

function identityHarness() {
  const values = new Map(), requests = [], events = {}, applied = [], recovery = [], button = {};
  let clears = 0, modals = 0, removed = 0, reloads = 0;
  const retainedInput = { value: 'synthetic unsaved draft' };
  const context = {
    window: { addEventListener: (name, fn) => { events[name] = fn; }, dispatchEvent() {} },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    document: { getElementById: id => id === 'identity-recovery' ? { remove() { removed++; } } : null,
      querySelector: () => button },
    Event: class Event {}, location: { reload() { reloads++; } }, confirm: () => false,
    AUTHENTICATED_STAFF: null, APP_SESSION_MAX_AGE: 30 * 86400000,
    identityPending: null, identityPendingKey: '', identityReadGeneration: 0,
    identityChangedElsewhere: false, BOOKING_BARBER: '', BOOKINGS_CACHE: [], bookingReadGeneration: 0, hairPickerReadGeneration: 0,
    employeeBookingsApi(operation, payload) { assert.equal(operation, 'session'); const item = deferred(); requests.push({ payload, ...item }); return item.promise; },
    showIdentityRecovery(message, retry) { recovery.push({ message, retry }); button.disabled = !retry; },
    showIdentityModal() { modals++; },
    clearBookingSession() { clears++; values.delete('booking-session'); context.AUTHENTICATED_STAFF = null; },
    applyAuthenticatedIdentity(staff) { applied.push(staff); context.AUTHENTICATED_STAFF = staff; values.set('booking-session', JSON.stringify(staff)); return true; },
  };
  vm.createContext(context);
  vm.runInContext(
    slice('  function isEmployeeSessionInvalid(', '  // Read-only helper:') +
    slice('  function verifiedEmployeeSession()', '  var bookingReadGeneration') +
    slice('  function employeeIdentityKey(', '  function showIdentityRecovery(') +
    slice('  function lockChangedIdentity()', '  function applyAuthenticatedIdentity('), context);
  function store(token = 'a', extra = {}) {
    const session = { username: 'synthetic-staff', store: 'synthetic-store', session_token: token, loggedAt: Date.now(), ...extra };
    values.set('booking-session', JSON.stringify(session)); return session;
  }
  const response = (username = 'synthetic-staff') => ({ user: { username, store: 'synthetic-store' }, expires_at: 'synthetic-expiry' });
  return { context, values, requests, events, applied, recovery, button, retainedInput, store, response,
    stats: () => ({ clears, modals, removed, reloads }) };
}

async function identityTests() {
  {
    const h = identityHarness(), before = h.store(), pending = h.context.checkIdentity();
    assert.equal(h.context.checkIdentity(), pending, 'same identity is single-flight');
    assert.equal(h.applied.length, 0, 'cached data alone is never authenticated');
    h.store('a', { loggedAt: before.loggedAt + 1, expires_at: 'metadata-updated-in-other-tab' });
    h.events.storage({ key: 'booking-session' });
    assert.equal(h.context.identityPending, pending, 'same-token metadata does not cancel verification');
    h.requests[0].resolve(h.response()); assert.equal(await pending, true);
    assert.equal(h.applied.length, 1); assert.equal(h.stats().removed, 1); assert.equal(h.stats().clears, 0);
    assert.equal(h.retainedInput.value, 'synthetic unsaved draft');
  }
  {
    const h = identityHarness(); h.store(); const old = h.context.checkIdentity();
    h.store('b'); // Same-document changes do not fire a storage event.
    h.requests[0].resolve(h.response('old-response')); assert.equal(await old, false);
    assert.equal(h.applied.length, 0); assert.equal(h.recovery.at(-1).retry, true);
    assert.equal(JSON.parse(h.values.get('booking-session')).session_token, 'b');
    const next = h.context.checkIdentity(); assert.equal(h.requests[1].payload.session_token, 'b');
    h.requests[1].resolve(h.response('new-response')); assert.equal(await next, true);
    assert.equal(h.applied[0].username, 'new-response'); assert.equal(h.stats().clears, 0);
  }
  {
    const h = identityHarness(); h.store();
    const get = h.context.localStorage.getItem;
    let changed = false;
    h.context.localStorage.getItem = key => {
      const value = get(key);
      if (key === 'booking-session' && !changed) { changed = true; h.store('b'); }
      return value;
    };
    const old = h.context.checkIdentity();
    assert.equal(h.requests[0].payload.session_token, 'a');
    h.requests[0].resolve(h.response('old-captured-identity'));
    assert.equal(await old, false, 'request key is derived from the same captured session as its token');
    assert.equal(h.applied.length, 0); assert.equal(h.recovery.at(-1).retry, true);
    assert.equal(JSON.parse(h.values.get('booking-session')).session_token, 'b');
  }
  {
    const h = identityHarness(); h.store(); const old = h.context.checkIdentity();
    h.store('b'); h.events.storage({ key: 'booking-session' });
    assert.equal(h.recovery.at(-1).retry, true); assert.equal(h.context.identityPending, null);
    const next = h.context.checkIdentity();
    h.requests[0].reject(Object.assign(new Error('登录已过期，请重新登录'), { status: 403 }));
    assert.equal(await old, false); assert.equal(h.context.identityPending, next, 'old finally cannot clear a newer read');
    assert.equal(h.stats().clears, 0); assert.equal(JSON.parse(h.values.get('booking-session')).session_token, 'b');
    h.requests[1].resolve(h.response('verified-new')); assert.equal(await next, true);
    assert.equal(h.applied.length, 1); assert.equal(h.applied[0].session_token, 'b');
  }
  {
    const h = identityHarness(); h.store(); const old = h.context.checkIdentity();
    h.values.clear(); h.events.storage({ key: null });
    assert.equal(h.recovery.at(-1).retry, true);
    h.requests[0].resolve(h.response()); assert.equal(await old, false); assert.equal(h.applied.length, 0);
    assert.equal(await h.context.checkIdentity(), false); assert.equal(h.stats().modals, 1);
  }
  for (const failure of [Object.assign(new Error('timeout'), { code: 'READ_TIMEOUT' }), Object.assign(new Error('没有此操作权限'), { status: 403 })]) {
    const h = identityHarness(); h.store(); const result = h.context.checkIdentity();
    h.requests[0].reject(failure); assert.equal(await result, false);
    assert.equal(h.recovery.at(-1).retry, true); assert.ok(h.values.get('booking-session'));
    assert.equal(h.stats().clears, 0); assert.equal(h.applied.length, 0);
    if (failure.code === 'READ_TIMEOUT') assert.match(h.recovery.at(-1).message, /超时/);
  }
  {
    const h = identityHarness(), session = h.store(); h.context.AUTHENTICATED_STAFF = session;
    h.context.BOOKING_BARBER = session.username; h.store('b'); h.events.storage({ key: 'booking-session' });
    assert.equal(h.context.identityChangedElsewhere, true); assert.equal(h.context.AUTHENTICATED_STAFF, null);
    assert.match(h.recovery.at(-1).message, /未保存输入仍保留/);
    h.button.onclick(); assert.equal(h.stats().reloads, 0, 'cancel never reloads or loses input');
    assert.equal(h.retainedInput.value, 'synthetic unsaved draft');
    assert.equal(JSON.parse(h.values.get('booking-session')).session_token, 'b');
  }
}

(async () => {
  await readTests(); await identityTests();
  console.log('perm identity/read deadline passed: hung fetch/body, ignored abort, cleanup, no write replay, metadata race, initial cross-tab change, stale error/new identity, draft preservation; synthetic only');
})().catch(error => { console.error(error); process.exitCode = 1; });
