import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProductionEmployeeAdapter, validateProductionDesignScope } from '../packages/design-production-adapter/employee-adapter.mjs';
import { createProductionArchiveAdapter, validateLegacyArchiveSnapshot } from '../packages/design-production-adapter/archive-adapter.mjs';
globalThis.fetch = () => { throw Error('Network forbidden in synthetic adapter tests'); };
const clone = v => structuredClone(v);
const TOKEN = '00000000-0000-4000-8000-00000000000100000000-0000-4000-8000-000000000002';
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const FRONT = '00000000-0000-4000-8000-000000000003';
const SCOPE = { customerProfileId: '11', visitId: 'booking:101', assignmentSource: 'appointment' };
const FRONT_SCOPE = { customerProfileId: '11', visitId: 'frontdesk:' + FRONT, assignmentSource: 'frontdesk' };
const DATE = '2026-11-15', STORE = '自由手艺人';
const reqId = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
function fixture() {
  const state = {
    now: Date.parse(DATE + 'T12:00:00Z'), calls: [],
    session: { username: 'synthetic-stylist', store: STORE, position: 'stylist', expires_at: DATE + 'T23:00:00Z' },
    staff: { username: 'synthetic-stylist', store: STORE, position: 'stylist', active: true, employment_status: 'active' },
    booking: { id: 101, barber_name: 'synthetic-stylist', shop_name: STORE, date: DATE, status: 0 },
    front: { id: FRONT, barber_name: 'synthetic-stylist', store: STORE, business_date: DATE, status: 'arrived' },
    profile: { id: 11, shop_name: STORE, card_packages: [], service_history: [] },
    binding: { customerProfileId: '11', active: true, revision: 'synthetic-binding-1' },
    transformRows: (table, rows) => rows, transformContext: v => v, transformBindings: v => v,
  };
  const deps = {
    clock: () => state.now,
    async restRows(path) {
      assert(!path.includes(TOKEN)); assert(!path.includes('phone')); assert(!path.includes('password'));
      state.calls.push({ kind: 'rows', path });
      const url = new URL(path, 'https://synthetic.invalid/'), table = url.pathname.slice(1);
      assert.equal(url.searchParams.get('limit'), '2');
      let row;
      if (table === 'employee_booking_sessions') {
        assert.equal(url.searchParams.get('token_hash'), 'eq.' + HASH);
        assert(url.searchParams.get('expires_at').startsWith('gt.')); row = state.session;
      } else if (table === 'staff') { assert.equal(url.searchParams.get('username'), 'eq.' + JSON.stringify(state.session.username)); row = state.staff; }
      else if (table === 'bookings') { assert.equal(url.searchParams.get('id'), 'eq.101'); row = state.booking; }
      else if (table === 'frontdesk_today_customers') { assert.equal(url.searchParams.get('id'), 'eq.' + FRONT); row = state.front; }
      else if (table === 'customer_profiles') { assert.equal(url.searchParams.get('id'), 'eq.11'); row = state.profile; }
      else throw Error('Unexpected table');
      return clone(state.transformRows(table, row ? [row] : []));
    },
    async resolveVisitBinding(row) {
      state.calls.push({ kind: 'binding', row });
      assert(Object.isFrozen(row)); assert(!Object.hasOwn(row, 'phone')); assert(!Object.hasOwn(row, 'credential'));
      return clone(state.transformBindings([{ assignmentSource: row.source, visitId: row.visitId, store: row.store, bookingDate: row.bookingDate,
        visitKey: row.source === 'appointment' ? row.visitId : `manual:${row.bookingDate}:${row.id}`, ...state.binding }]));
    },
    async rpc(name, params) {
      state.calls.push({ kind: 'rpc', name, params }); assert.equal(name, 'customer_design_resolve_context');
      assert(!JSON.stringify(params).includes(TOKEN));
      return clone(state.transformContext({ customer_profile_id: params.p_customer_profile_id, booking_id: params.p_booking_id, booking_date: params.p_booking_date, visit_key: params.p_visit_key, store: state.profile.shop_name, name: 'Synthetic not returned', phone: 'synthetic-not-returned' }));
    },
  };
  return { state, deps, adapter: createProductionEmployeeAdapter(deps) };
}
function snapshot() {
  const steps = Object.fromEntries(['style', 'person', 'length', 'features', 'layers', 'bangs', 'curls', 'care'].map(k => [k, '']));
  return { baseline: { outline: '合成轮廓', root_flow: '', steps }, optimized: { outline: '', root_flow: '', steps: { ...steps } },
    reasons: { outline: '', root_flow: '', ...steps }, execution: {}, process: {}, review: {}, status: 'baseline', photo_ids: [], archive_url: null };
}
function transactionFixture(base = fixture()) {
  let committed = [], queue = Promise.resolve();
  const flags = { beforeCommit: null, afterAppend: null, loseAck: false, corruptResult: v => v, skipGuard: false };
  const transaction = callback => {
    const run = queue.then(async () => {
      const pending = clone(committed), hooks = [];
      const rpc = async (name, params) => {
        if (name !== 'append_customer_design_version') return base.deps.rpc(name, params);
        base.state.calls.push({ kind: 'append', params });
        assert(!JSON.stringify(params).includes(TOKEN));
        assert.equal(params.p_actor, base.state.staff.username); assert.equal(params.p_source, 'manual');
        const p = params.p_payload, fingerprint = JSON.stringify(params);
        const prior = pending.find(row => row.version.request_id === p.request_id);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw Object.assign(Error('CUSTOMER_DESIGN_REQUEST_REUSED'), { code: '22023' });
          return clone({ saved: true, already_applied: true, latest_version_id: prior.version.id, version: prior.version });
        }
        const history = pending.filter(row => row.version.customer_profile_id === p.customer_profile_id && row.version.visit_key === p.visit_key);
        const last = history.at(-1)?.version;
        if ((last?.id || null) !== p.expected_latest_version_id) throw Object.assign(Error('CUSTOMER_DESIGN_VERSION_CONFLICT'), { code: '40001' });
        const { expected_latest_version_id, ...body } = p;
        const optional = (v, keys) => Object.values(v).some(Boolean) ? Object.fromEntries(keys.map(k => [k, v[k] || ''])) : {};
        body.process = optional(body.process, ['care_texture','styling','style_feel','application','winding','rod_direction','curl_control','thinning_space','proposal','technique_layers']);
        body.review = optional(body.review, ['achieved','pending','next']);
        body.execution = Object.values(body.execution).some(r => Object.values(r).some(Boolean)) ? Object.fromEntries(['bangs','top','ear_front','ear_back','middle','bottom'].map(z => [z, Object.fromEntries(['issue','target','actions','check'].map(k => [k, body.execution[z]?.[k] || '']))])) : {};
        body.archive_url = '';
        const version = { ...body, id: reqId(100 + pending.length), version_no: history.length + 1, previous_version_id: last?.id || null,
          source: params.p_source, author: params.p_actor, created_at: new Date(base.state.now).toISOString(), photos: [], request_hash: 'private-hash' };
        pending.push({ version: clone(version), fingerprint });
        if (flags.afterAppend) await flags.afterAppend();
        return flags.corruptResult(clone({ saved: true, already_applied: false, latest_version_id: version.id, version }));
      };
      const result = await callback({ ...base.deps, rpc, beforeCommit: hook => { hooks.push(hook); } });
      if (flags.beforeCommit) await flags.beforeCommit();
      if (!flags.skipGuard) for (const hook of hooks) await hook();
      committed = pending;
      if (flags.loseAck) { flags.loseAck = false; throw Error('synthetic response lost after commit'); }
      return result;
    });
    queue = run.catch(() => undefined); return run;
  };
  return { ...base, flags, transaction, history: () => clone(committed), archive: createProductionArchiveAdapter({ employeeAdapter: base.adapter, transaction }) };
}
const request = (n = 1, patch = {}) => ({ credential: TOKEN, scope: SCOPE, requestId: reqId(n), expectedLatestVersionId: null, snapshot: snapshot(), ...patch });

test('unconfigured adapters fail closed without network or credential reads', async () => {
  const adapter = createProductionEmployeeAdapter();
  await rejects(adapter.authenticate(TOKEN), 'EMPLOYEE_ADAPTER_NOT_CONFIGURED');
  await rejects(adapter.gate.authorize(TOKEN, SCOPE), 'EMPLOYEE_ADAPTER_NOT_CONFIGURED');
  await rejects(createProductionArchiveAdapter().appendLegacyVersion(request()), 'ARCHIVE_TRANSACTION_NOT_CONFIGURED');
});
test('custom token is SHA-256 looked up and unique active staff/store revalidated without renewal', async () => {
  const { adapter, state } = fixture();
  const employee = await adapter.authenticate(TOKEN);
  assert.deepEqual(employee, { username: 'synthetic-stylist', store: STORE, active: true, expiresAt: Date.parse(state.session.expires_at) });
  assert.equal(state.calls.length, 2); assert(Object.isFrozen(employee)); assert(!JSON.stringify(employee).includes(TOKEN));
});
test('credentials are opaque, not actor headers/objects or browser identity claims', async () => {
  for (const credential of [{ session_token: TOKEN }, { actor: 'demo-ui-owner' }, 'demo-ui-owner', TOKEN + '\n', '', null]) {
    const { adapter, state } = fixture(); await rejects(adapter.authenticate(credential), 'AUTHENTICATION_REQUIRED'); assert.equal(state.calls.length, 0);
  }
});
test('missing, expired, malformed and ambiguous sessions deny', async () => {
  for (const change of [s => { s.session = null; }, s => { s.session.expires_at = DATE + 'T12:00:00Z'; }, s => { s.session.expires_at = 'invalid'; }, s => { s.transformRows = (t, r) => t === 'employee_booking_sessions' ? [...r, ...r] : r; }]) {
    const { state, adapter } = fixture(); change(state); await rejects(adapter.authenticate(TOKEN), 'AUTHENTICATION_REQUIRED');
  }
});
test('staff inactive, departed, renamed, moved store, missing, ambiguous and unsupported store deny', async () => {
  for (const change of [s => { s.staff.active = false; }, s => { s.staff.active = null; }, s => { s.staff.employment_status = 'left'; }, s => { s.staff.username = 'other'; }, s => { s.staff.store = '向里造型'; }, s => { s.staff = null; }, s => { s.transformRows = (t,r) => t === 'staff' ? [...r,...r] : r; }, s => { s.staff.store = s.session.store = 'unknown'; }]) {
    const { state, adapter } = fixture(); change(state); await rejects(adapter.authenticate(TOKEN), 'AUTHENTICATION_REQUIRED');
  }
});
test('staff lookup is safely quoted, without truncating or normalizing username identity', async () => {
  const { state, adapter } = fixture(); state.session.username = state.staff.username = 'synthetic,"(staff)';
  assert.equal((await adapter.authenticate(TOKEN)).username, state.staff.username);
  assert(state.calls[1].path.includes('%22')); assert(!state.calls[1].path.includes('synthetic,"'));
});
test('scope is exact canonical server locator, no owner, phone/name, store or query injection', async () => {
  for (const value of [{ ...SCOPE, owner: true }, { ...SCOPE, customerProfileId: '011' }, { ...SCOPE, visitId: '101' }, { ...SCOPE, visitId: 'booking:101&limit=999' }, { ...SCOPE, assignmentSource: 'all' }, { ...SCOPE, phone: 'same' }, { ...SCOPE, store: STORE }, { ...SCOPE, name: 'same' }]) {
    assert.throws(() => validateProductionDesignScope(value), e => e.code === 'INVALID_SCOPE');
    const { adapter, state } = fixture(); await rejects(adapter.gate.authorize(TOKEN, value), 'INVALID_SCOPE'); assert.equal(state.calls.length, 0);
  }
});
test('stable binding must be injected; same phone/name cannot supply it', async () => {
  const { deps, state } = fixture(); delete deps.resolveVisitBinding;
  await rejects(createProductionEmployeeAdapter(deps).gate.authorize(TOKEN, SCOPE), 'CUSTOMER_BINDING_REQUIRED'); assert.equal(state.calls.length, 0);
  for (const values of [[], [{ customerProfileId: '11' }]]) {
    const f = fixture(); f.state.transformBindings = () => values;
    await rejects(f.adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_UNAVAILABLE');
  }
});
test('exact appointment grant and shared resolver context omit all identity/contact/token extras', async () => {
  const { adapter } = fixture();
  assert.deepEqual(await adapter.gate.authorize(TOKEN, SCOPE), { actor: { username: 'synthetic-stylist', store: STORE }, scope: SCOPE });
  const result = await adapter.resolveArchiveContext({ credential: TOKEN, scope: SCOPE });
  assert.deepEqual(result.context, { customer_profile_id: 11, booking_id: 101, booking_date: DATE, visit_key: 'booking:101', store: STORE });
  assert(!JSON.stringify(result).includes('phone')); assert(!JSON.stringify(result).includes('Synthetic not returned')); assert(Object.isFrozen(result.context));
});
test('frontdesk UUID and manual visit key are distinct from appointment and same-day visits', async () => {
  const { adapter, state } = fixture();
  const result = await adapter.resolveArchiveContext({ credential: TOKEN, scope: FRONT_SCOPE });
  assert.equal(result.context.booking_id, null); assert.equal(result.context.visit_key, `manual:${DATE}:${FRONT}`);
  assert(state.calls.some(c => c.path?.startsWith('frontdesk_today_customers?')));
});
test('missing, duplicate, inactive, malformed or wrong assignment cannot authorize', async () => {
  for (const change of [s => { s.booking = null; }, s => { s.booking.id = 102; }, s => { s.booking.status = 2; }, s => { s.booking.status = '0'; }, s => { s.booking.date = '2026-02-30'; }, s => { s.transformRows = (t,r) => t === 'bookings' ? [...r,...r] : r; }]) {
    const { state, adapter } = fixture(); change(state); await rejects(adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_UNAVAILABLE');
  }
  const f = fixture(); f.state.front.status = 'cancelled'; await rejects(f.adapter.gate.authorize(TOKEN, FRONT_SCOPE), 'RELATIONSHIP_UNAVAILABLE');
});
test('reassignment and cross-store grant mismatch deny', async () => {
  const a = fixture(); a.state.booking.barber_name = 'other'; await rejects(a.adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_DENIED');
  const b = fixture(); b.state.booking.shop_name = b.state.profile.shop_name = '向里造型'; await rejects(b.adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_UNAVAILABLE');
});
test('ambiguous, stale, revoked and mismatched explicit bindings fail closed', async () => {
  for (const change of [s => { s.binding.active = false; }, s => { s.binding.customerProfileId = '12'; }, s => { s.binding.revision = ''; }, s => { s.transformBindings = rows => [...rows,...rows]; }, s => { s.transformBindings = rows => [{ ...rows[0], visitKey: 'manual:' + DATE }]; }]) {
    const { state, adapter } = fixture(); change(state); await rejects(adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_UNAVAILABLE');
  }
});
test('shared resolver/profile mismatch and ambiguity are not rescued by cross-store read sharing', async () => {
  for (const change of [s => { s.profile.id = 12; }, s => { s.profile.shop_name = '向里造型'; s.profile.card_packages = [{ shop: STORE }]; }, s => { s.transformRows = (t,r) => t === 'customer_profiles' ? [...r,...r] : r; }, s => { s.transformContext = c => ({ ...c, visit_key: 'booking:102' }); }, s => { s.transformContext = c => ({ ...c, store: '向里造型' }); }]) {
    const { state, adapter } = fixture(); change(state); await rejects(adapter.gate.authorize(TOKEN, SCOPE), 'RELATIONSHIP_UNAVAILABLE');
  }
});
test('delayed read with revoked session or assignment never returns previous data', async () => {
  for (const change of [s => { s.staff.active = false; }, s => { s.booking.barber_name = 'other'; }]) {
    const { state, adapter } = fixture(); let delivered = false;
    await assert.rejects(adapter.gate.withAuthorizedRead({ credential: TOKEN, scope: SCOPE }, async () => { change(state); return { private: true }; }).then(() => { delivered = true; }));
    assert.equal(delivered, false);
  }
});
test('expiration during source reads and sanitized source failure deny without leaking details', async () => {
  const f = fixture(); const original = f.deps.restRows;
  f.deps.restRows = async p => { const rows = await original(p); if (p.startsWith('staff?')) f.state.now = Date.parse(f.state.session.expires_at); return rows; };
  await rejects(createProductionEmployeeAdapter(f.deps).authenticate(TOKEN), 'AUTHENTICATION_REQUIRED');
  const bad = createProductionEmployeeAdapter({ ...fixture().deps, restRows: async () => { throw Error(TOKEN + ' private URL'); } });
  await assert.rejects(bad.authenticate(TOKEN), error => error.code === 'AUTHENTICATION_REQUIRED' && !error.message.includes(TOKEN));
});
test('archive schema rejects full UI projection, arbitrary authority, history, URLs and prototype keys', () => {
  for (const patch of [{ schemaVersion: 'design-pilot-ui-draft-v1' }, { history: [] }, { source: 'chatgpt' }, { author: 'owner' }, { archive_url: 'https://example.com' }, { photos: ['data:image/png;base64,AA'] }]) assert.throws(() => validateLegacyArchiveSnapshot({ ...snapshot(), ...patch }));
  const poisoned = JSON.parse(JSON.stringify(snapshot()).replace('"baseline":', '"__proto__":{},"baseline":')); assert.throws(() => validateLegacyArchiveSnapshot(poisoned));
  const changed = snapshot(); changed.optimized.outline = '另一合成轮廓'; assert.throws(() => validateLegacyArchiveSnapshot(changed), e => e.code === 'ARCHIVE_REASON_REQUIRED');
});
test('archive missing transaction refuses before source reads', async () => {
  const { adapter, state } = fixture(); await rejects(createProductionArchiveAdapter({ employeeAdapter: adapter }).appendLegacyVersion(request()), 'ARCHIVE_TRANSACTION_NOT_CONFIGURED'); assert.equal(state.calls.length, 0);
});
test('parameterized append uses server actor/context and immutable previous-version chain', async () => {
  const f = transactionFixture(); const first = await f.archive.appendLegacyVersion(request());
  const old = f.history()[0]; const nextSnapshot = snapshot(); nextSnapshot.baseline.outline = '后续合成轮廓';
  const second = await f.archive.appendLegacyVersion(request(2, { expectedLatestVersionId: first.appliedVersionId, snapshot: nextSnapshot }));
  assert.equal(second.version.previousVersionId, first.appliedVersionId); assert.equal(second.version.versionNumber, 2); assert.deepEqual(f.history()[0], old);
  assert(!JSON.stringify(first).includes('request_hash')); assert(!JSON.stringify(first).includes(TOKEN)); assert(Object.isFrozen(second.version.snapshot));
  assert.equal(f.state.calls.filter(c => c.kind === 'append').length, 2);
});
test('same request retry is idempotent, changed payload conflicts and original history survives', async () => {
  const f = transactionFixture(), first = await f.archive.appendLegacyVersion(request());
  const replay = await f.archive.appendLegacyVersion(request()); assert.equal(replay.alreadyApplied, true); assert.equal(replay.appliedVersionId, first.appliedVersionId); assert.equal(f.history().length, 1);
  const changed = snapshot(); changed.baseline.outline = '不同'; await rejects(f.archive.appendLegacyVersion(request(1, { snapshot: changed })), 'ARCHIVE_REQUEST_CONFLICT'); assert.equal(f.history().length, 1);
});
test('concurrent CAS has one append winner, no lost old version', async () => {
  const f = transactionFixture(); const results = await Promise.allSettled([f.archive.appendLegacyVersion(request(1)), f.archive.appendLegacyVersion(request(2))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ARCHIVE_VERSION_CONFLICT'); assert.equal(f.history().length, 1);
});
test('revocation after append before transaction commit rolls back pending version', async () => {
  for (const change of [s => { s.staff.active = false; }, s => { s.booking.barber_name = 'other'; }, s => { s.binding.revision = 'changed'; }]) {
    const f = transactionFixture(); f.flags.beforeCommit = async () => change(f.state);
    await assert.rejects(f.archive.appendLegacyVersion(request())); assert.equal(f.history().length, 0);
  }
});
test('malicious RPC scope/actor/payload/parent result rejects and rolls back', async () => {
  for (const patch of [{ store: '向里造型' }, { customer_profile_id: 12 }, { author: 'other' }, { previous_version_id: reqId(20) }, { baseline: { outline: 'wrong' } }]) {
    const f = transactionFixture(); f.flags.corruptResult = r => ({ ...r, version: { ...r.version, ...patch } });
    await assert.rejects(f.archive.appendLegacyVersion(request())); assert.equal(f.history().length, 0);
  }
});
test('lost commit acknowledgment is explicitly uncertain and same request safely replays', async () => {
  const f = transactionFixture(); f.flags.loseAck = true;
  await rejects(f.archive.appendLegacyVersion(request()), 'ARCHIVE_OUTCOME_UNCERTAIN'); assert.equal(f.history().length, 1);
  const result = await f.archive.appendLegacyVersion(request()); assert.equal(result.alreadyApplied, true); assert.equal(f.history().length, 1);
});
test('retry after revocation is denied even when receipt already exists', async () => {
  const f = transactionFixture(); await f.archive.appendLegacyVersion(request()); f.state.staff.active = false;
  await assert.rejects(f.archive.appendLegacyVersion(request())); assert.equal(f.history().length, 1);
});
test('frontdesk transactional archive keeps UUID-linked distinct manual visit identity', async () => {
  const f = transactionFixture(); const result = await f.archive.appendLegacyVersion(request(1, { scope: FRONT_SCOPE }));
  assert.equal(result.version.scope.visitId, FRONT_SCOPE.visitId); assert.equal(f.history()[0].version.visit_key, `manual:${DATE}:${FRONT}`);
});
test('transaction executor cannot silently omit callback or precommit guard', async () => {
  const f = fixture(); await rejects(createProductionArchiveAdapter({ employeeAdapter: f.adapter, transaction: async () => ({}) }).appendLegacyVersion(request()), 'ARCHIVE_TRANSACTION_NOT_EXECUTED');
  const broken = transactionFixture(); broken.flags.skipGuard = true; await rejects(broken.archive.appendLegacyVersion(request()), 'ARCHIVE_OUTCOME_UNCERTAIN');
});


test('actual SQL blank-link and optional six-zone/process/review normalization are verified', async () => {
  const f = transactionFixture(), document = snapshot();
  document.execution = { top: { actions: '合成顶部执行' } }; document.process = { winding: '合成方法' }; document.review = { pending: '未确认' };
  const result = await f.archive.appendLegacyVersion(request(1, { snapshot: document }));
  assert.equal(f.history()[0].version.archive_url, ''); assert.equal(result.version.snapshot.archive_url, null);
  assert.equal(result.version.snapshot.execution.top.actions, '合成顶部执行'); assert.equal(result.version.snapshot.execution.bottom.actions, '');
  assert.equal(result.version.snapshot.process.winding, '合成方法'); assert.equal(result.version.snapshot.review.pending, '未确认');
  assert.equal((await f.archive.appendLegacyVersion(request(1, { snapshot: document }))).alreadyApplied, true);
});
test('archive caller mutation cannot redirect awaited scope, snapshot or expected parent', async () => {
  const f = transactionFixture(), value = request(); value.scope = { ...SCOPE };
  const promise = f.archive.appendLegacyVersion(value); value.scope.customerProfileId = '12'; value.snapshot.baseline.outline = 'mutated'; value.expectedLatestVersionId = reqId(42);
  const result = await promise; assert.equal(result.version.scope.customerProfileId, '11'); assert.equal(result.version.snapshot.baseline.outline, '合成轮廓'); assert.equal(result.version.previousVersionId, null);
});
test('schema bounds and unknown nested source/group fields are never silently stripped', () => {
  for (const mutate of [d => { d.baseline.steps.style = 'x'.repeat(4001); }, d => { d.execution.top = { groupId: 'lost-group' }; }, d => { d.process.tracks = {}; }, d => { d.photo_ids = [reqId(2),reqId(2)]; }, d => { d.photo_ids = ['https://example.invalid/photo']; }, d => { d.review.achieved = null; }]) {
    const d = snapshot(); mutate(d); assert.throws(() => validateLegacyArchiveSnapshot(d));
  }
});
test('rechecked stable binding revision change prevents transaction entry', async () => {
  const f = fixture(); const original = f.adapter.resolveArchiveContext; let count = 0;
  const employeeAdapter = { resolveArchiveContext: async q => { const result = await original(q); count++; if (count === 1) f.state.binding.revision = 'new'; return result; } };
  const tx = transactionFixture(f); const adapter = createProductionArchiveAdapter({ employeeAdapter, transaction: tx.transaction });
  await rejects(adapter.appendLegacyVersion(request()), 'ARCHIVE_AUTHORIZATION_CHANGED'); assert.equal(tx.history().length, 0);
});
