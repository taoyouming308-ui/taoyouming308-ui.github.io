import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVisitBindingAdapter, validateVisitBindingHistory } from '../packages/design-production-adapter/visit-binding.mjs';
import { createProductionEmployeeAdapter } from '../packages/design-production-adapter/employee-adapter.mjs';
globalThis.fetch = () => { throw Error('Synthetic tests must not use network'); };
const DATE = '2026-11-15', STORE = '自由手艺人', TIME = Date.parse(DATE + 'T12:00:00Z');
const uuid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = n => uuid(n) + uuid(n + 1000);
const OP = token(1), A = token(2), B = token(3), FRONT = uuid(4);
const VISIT = { assignmentSource: 'appointment', visitId: 'booking:101' };
const FRONT_VISIT = { assignmentSource: 'frontdesk', visitId: 'frontdesk:' + FRONT };
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : canon(v)).digest('hex');
const clone = structuredClone;
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const row = (state, visit = VISIT) => {
  const raw = visit.assignmentSource === 'appointment' ? state.booking : state.front;
  if (!raw) return null;
  return { source: visit.assignmentSource, visitId: visit.visitId, id: String(raw.id), staffUsername: raw.barber_name,
    store: raw.shop_name || raw.store, bookingDate: raw.date || raw.business_date, status: raw.status };
};
function fixture() {
  let ledger = { histories: {}, requests: {}, approvals: {} }, queue = Promise.resolve();
  const state = { now: TIME, allowOperator: true, allowLifecycle: true, policyRevision: 'reviewed-synthetic-lifecycle-1', calls: [],
    staff: { reviewer: { username: 'reviewer', store: STORE, active: true, employment_status: 'active' }, stylistA: { username: 'stylistA', store: STORE, active: true, employment_status: 'active' }, stylistB: { username: 'stylistB', store: STORE, active: true, employment_status: 'active' } },
    sessions: Object.fromEntries([[OP, 'reviewer'], [A, 'stylistA'], [B, 'stylistB']].map(([t, username]) => [hash(t), { username, store: STORE, expires_at: DATE + 'T23:00:00Z' }])),
    booking: { id: 101, barber_name: 'stylistA', shop_name: STORE, date: DATE, status: 0 },
    front: { id: FRONT, barber_name: 'stylistA', store: STORE, business_date: DATE, status: 'arrived' },
    profiles: { '11': { id: 11, shop_name: STORE }, '12': { id: 12, shop_name: STORE } },
    transformRows: (table, values) => values, afterReadHistory: null, beforeCommit: null, afterAppend: null, loseAck: false,
  };
  const restRows = async path => {
    state.calls.push(path); assert(!path.includes(OP)); assert(!path.includes(A)); assert(!path.includes('phone')); assert(!path.includes('customer_name')); assert(!path.includes('password'));
    const url = new URL(path, 'https://synthetic.invalid/'), table = url.pathname.slice(1), q = url.searchParams;
    assert.equal(q.get('limit'), '2');
    let value;
    if (table === 'employee_booking_sessions') value = state.sessions[q.get('token_hash')?.slice(3)];
    else if (table === 'staff') value = state.staff[JSON.parse(q.get('username').slice(3))];
    else if (table === 'bookings') value = q.get('id') === 'eq.101' ? state.booking : null;
    else if (table === 'frontdesk_today_customers') value = q.get('id') === 'eq.' + FRONT ? state.front : null;
    else if (table === 'customer_profiles') value = state.profiles[q.get('id')?.slice(3)];
    else throw Error('Unexpected source');
    return clone(state.transformRows(table, value ? [value] : []));
  };
  const rpc = async (name, p) => {
    assert.equal(name, 'customer_design_resolve_context');
    return { customer_profile_id: p.p_customer_profile_id, booking_id: p.p_booking_id, booking_date: p.p_booking_date, visit_key: p.p_visit_key, store: state.profiles[String(p.p_customer_profile_id)]?.shop_name, name: 'not propagated', phone: 'not propagated' };
  };
  function txFor(candidate, hooks) {
    return { restRows, rpc,
      evaluateLifecycle: async current => { assert(!Object.hasOwn(current, 'customerProfileId')); return { allowed: state.allowLifecycle, policyRevision: state.policyRevision }; },
      readBindingHistory: async visit => { const result = clone(candidate.histories[visit.visitId] || []); if (state.afterReadHistory) await state.afterReadHistory(); return result; },
      readRequest: async id => clone(candidate.requests[id] || null),
      authorizeOperator: async ({ actor }) => { if (state.afterAuthorizeOperator) await state.afterAuthorizeOperator(); return state.allowOperator && actor.username === 'reviewer' && actor.store === STORE; },
      consumeApproval: async ({ approval, intent, intentSha256 }) => {
        const grant = candidate.approvals[approval];
        if (!grant || grant.expiresAt <= state.now || !assertIntent(intent, grant.intent) || intentSha256 !== hash(intent)) throw Error('Invalid approval');
        delete candidate.approvals[approval]; return { receiptId: 'verified-' + approval, intentSha256, expiresAt: grant.expiresAt };
      },
      appendVersion: async ({ expectedRevision, record, receipt }) => {
        const history = candidate.histories[record.visit.visitId] || [];
        if (history.length !== expectedRevision || candidate.requests[receipt.requestId]) return false;
        candidate.histories[record.visit.visitId] = [...history, clone(record)]; candidate.requests[receipt.requestId] = clone(receipt);
        if (state.afterAppend) await state.afterAppend(); return true;
      }, beforeCommit: hook => hooks.push(hook),
    };
  }
  const readTransaction = async callback => callback(txFor(ledger, []));
  const writeTransaction = callback => {
    const action = queue.then(async () => {
      const candidate = clone(ledger), hooks = [], result = await callback(txFor(candidate, hooks));
      if (state.beforeCommit) await state.beforeCommit(); for (const hook of hooks) await hook();
      ledger = candidate;
      if (state.loseAck) { state.loseAck = false; throw Error('Acknowledgment lost'); } return result;
    }); queue = action.catch(() => {}); return action;
  };
  const binding = createVisitBindingAdapter({ readTransaction, writeTransaction, clock: () => state.now });
  const employee = createProductionEmployeeAdapter({ restRows, rpc, resolveVisitBinding: binding.resolveVisitBinding, clock: () => state.now });
  function issue(n, patch = {}) {
    const request = { credential: OP, requestId: uuid(n + 10), expectedRevision: 0, action: 'bind', visit: { ...VISIT }, customerProfileId: '11', approval: 'synthetic-approval-' + n, ...patch };
    const prior = (ledger.histories[request.visit.visitId] || []).at(-1), current = request.action === 'revoke' ? null : row(state, request.visit), basis = current || prior;
    const actor = { username: 'reviewer', store: STORE };
    const fixed = Object.fromEntries(['requestId', 'expectedRevision', 'action', 'visit', 'customerProfileId'].map(k => [k, clone(request[k])]));
    const intent = { actor, command: fixed, previousRevision: prior?.revision || 0, previousState: prior?.state || null,
      target: { customerProfileId: request.customerProfileId, store: basis?.store, bookingDate: basis?.bookingDate, visitKey: request.visit.assignmentSource === 'appointment' ? request.visit.visitId : `manual:${basis?.bookingDate}:${request.visit.visitId.slice(10)}`, staffUsername: basis?.staffUsername },
      sourceStatus: current?.status ?? null, policyRevision: current ? state.policyRevision : null };
    ledger.approvals[request.approval] = { intent, expiresAt: state.now + 60000 }; return request;
  }
  return { state, binding, employee, issue, ledger: () => clone(ledger), corrupt: fn => fn(ledger), readTransaction, writeTransaction };
}
function assertIntent(a, b) { return canon(a) === canon(b); }

test('unconfigured binding denies and no transaction/policy is assumed', async () => {
  const f = fixture(); await rejects(createVisitBindingAdapter().resolveVisitBinding(row(f.state)), 'BINDING_TRANSACTION_NOT_CONFIGURED');
  await rejects(createVisitBindingAdapter().applyChange(f.issue(1)), 'BINDING_TRANSACTION_NOT_CONFIGURED');
});
test('first explicit verified binding composes with actual employee adapter, no name/phone inference', async () => {
  const f = fixture(); assert.deepEqual(await f.binding.resolveVisitBinding(row(f.state)), []);
  const result = await f.binding.applyChange(f.issue(1)); assert.equal(result.appliedRevision, 1);
  const scope = { ...VISIT, customerProfileId: '11' }; const grant = await f.employee.gate.authorize(A, scope);
  assert.equal(grant.actor.username, 'stylistA'); assert.equal((await f.binding.resolveVisitBinding(row(f.state)))[0].revision, 'binding:1');
  assert(!JSON.stringify(result).includes('approval')); assert(!JSON.stringify(f.ledger()).includes(OP));
});
test('same names or phones and caller chosen profile alone cannot create mapping', async () => {
  const f = fixture(), request = f.issue(1); request.approval = 'missing';
  await rejects(f.binding.applyChange(request), 'BINDING_APPROVAL_REQUIRED'); assert.deepEqual(f.ledger().histories, {});
  const approved = f.issue(2); approved.customerProfileId = '12'; await rejects(f.binding.applyChange(approved), 'BINDING_APPROVAL_REQUIRED');
  assert.deepEqual(await f.binding.resolveVisitBinding(row(f.state)), []);
});
test('operator capability is independent of active assigned employee authentication', async () => {
  const f = fixture(); await rejects(f.binding.applyChange(f.issue(1, { credential: A })), 'BINDING_OPERATOR_DENIED');
  f.state.allowOperator = false; await rejects(f.binding.applyChange(f.issue(2)), 'BINDING_OPERATOR_DENIED');
});
test('unknown lifecycle policy and expired exact approval fail closed', async () => {
  const f = fixture(); f.state.allowLifecycle = false; await rejects(f.binding.applyChange(f.issue(1)), 'BINDING_LIFECYCLE_UNCONFIRMED');
  f.state.allowLifecycle = true; const request = f.issue(2); f.state.now += 60001; await rejects(f.binding.applyChange(request), 'BINDING_APPROVAL_REQUIRED');
});
test('source reassignment revokes old grant immediately and requires explicit appended reassign', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); const first = f.ledger().histories[VISIT.visitId][0];
  f.state.booking.barber_name = 'stylistB'; await assert.rejects(f.employee.gate.authorize(A, { ...VISIT, customerProfileId: '11' }));
  await rejects(f.binding.resolveVisitBinding(row(f.state)), 'BINDING_SOURCE_CHANGED');
  await f.binding.applyChange(f.issue(2, { action: 'reassign', expectedRevision: 1 }));
  assert.equal((await f.employee.gate.authorize(B, { ...VISIT, customerProfileId: '11' })).actor.username, 'stylistB');
  assert.deepEqual(f.ledger().histories[VISIT.visitId][0], first);
});
test('source deletion still permits explicit revoke without profile/source reads', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); const current = row(f.state); f.state.booking = null; f.state.profiles = {};
  await f.binding.applyChange(f.issue(2, { action: 'revoke', expectedRevision: 1 }));
  assert.deepEqual(await f.binding.resolveVisitBinding(current), []); assert.equal(f.ledger().histories[VISIT.visitId].at(-1).state, 'revoked');
});
test('restore is explicit and same-stylist only; reassign handles changed stylist from revoked', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); await f.binding.applyChange(f.issue(2, { action: 'revoke', expectedRevision: 1 }));
  await f.binding.applyChange(f.issue(3, { action: 'restore', expectedRevision: 2 })); assert.equal((await f.binding.resolveVisitBinding(row(f.state)))[0].revision, 'binding:3');
  await f.binding.applyChange(f.issue(4, { action: 'revoke', expectedRevision: 3 })); f.state.booking.barber_name = 'stylistB';
  await rejects(f.binding.applyChange(f.issue(5, { action: 'restore', expectedRevision: 4 })), 'BINDING_TRANSITION_INVALID');
  await f.binding.applyChange(f.issue(6, { action: 'reassign', expectedRevision: 4 }));
});
test('profile, store and service date cannot silently rebind an old visit', async () => {
  for (const mutate of [f => ({ customerProfileId: '12' }), f => { f.state.booking.date = '2026-11-16'; return {}; }, f => { f.state.booking.shop_name = '向里造型'; return {}; }]) {
    const f = fixture(); await f.binding.applyChange(f.issue(1)); f.state.booking.barber_name = 'stylistB'; const patch = mutate(f);
    await assert.rejects(f.binding.applyChange(f.issue(2, { action: 'reassign', expectedRevision: 1, ...patch }))); assert.equal(f.ledger().histories[VISIT.visitId].length, 1);
  }
});
test('unknown extra fields, ambiguous source/profile and inactive target employee reject', async () => {
  const a = fixture(); await rejects(a.binding.applyChange({ ...a.issue(1), owner: true }), 'BINDING_INVALID_FIELDS');
  const b = fixture(); await rejects(b.binding.resolveVisitBinding({ ...row(b.state), phone: 'identity-substitute' }), 'BINDING_INVALID_FIELDS');
  for (const table of ['bookings', 'customer_profiles', 'staff']) {
    const f = fixture(); f.state.transformRows = (t,r) => t === table ? [...r,...r] : r; await assert.rejects(f.binding.applyChange(f.issue(1)));
  }
  const c = fixture(); c.state.staff.stylistA.active = false; await rejects(c.binding.applyChange(c.issue(1)), 'BINDING_STYLIST_INACTIVE');
});
test('frontdesk UUID remains a distinct manual visit and never merges with same profile appointment', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); await f.binding.applyChange(f.issue(2, { visit: FRONT_VISIT }));
  const result = await f.binding.resolveVisitBinding(row(f.state, FRONT_VISIT)); assert.equal(result[0].visitKey, `manual:${DATE}:${FRONT}`);
  assert.equal(Object.keys(f.ledger().histories).length, 2);
});
test('same request exact replay, altered payload conflict and fresh permission checks', async () => {
  const f = fixture(), request = f.issue(1); await f.binding.applyChange(request); const before = f.ledger();
  assert.equal((await f.binding.applyChange(request)).replayed, true); assert.deepEqual(f.ledger(), before);
  await rejects(f.binding.applyChange({ ...request, customerProfileId: '12' }), 'BINDING_REQUEST_CONFLICT');
  f.state.allowOperator = false; await rejects(f.binding.applyChange(request), 'BINDING_OPERATOR_DENIED');
});
test('replay of an old bind cannot undo later revocation or pretend applied version is current', async () => {
  const f = fixture(), request = f.issue(1); await f.binding.applyChange(request); await f.binding.applyChange(f.issue(2, { action: 'revoke', expectedRevision: 1 }));
  const replay = await f.binding.applyChange(request); assert.equal(replay.appliedRevision, 1); assert.equal(replay.currentRevision, 2); assert.deepEqual(await f.binding.resolveVisitBinding(row(f.state)), []);
});
test('concurrent same-head commands get one winner and one CAS conflict', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.binding.applyChange(f.issue(1)), f.binding.applyChange(f.issue(2))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'BINDING_REVISION_CONFLICT');
  assert.equal(f.ledger().histories[VISIT.visitId].length, 1);
});
test('late reassignment, lifecycle revocation or operator deactivation rolls back record and approval', async () => {
  for (const mutate of [f => { f.state.booking.barber_name = 'stylistB'; }, f => { f.state.allowLifecycle = false; }, f => { f.state.staff.reviewer.active = false; }]) {
    const f = fixture(), request = f.issue(1), before = f.ledger(); f.state.beforeCommit = async () => mutate(f);
    await assert.rejects(f.binding.applyChange(request)); assert.deepEqual(f.ledger(), before);
  }
});
test('read callback delayed source change cannot return old active binding', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); const initial = row(f.state); let changed = false;
  f.state.afterReadHistory = async () => { if (!changed) { changed = true; f.state.booking.barber_name = 'stylistB'; } };
  await rejects(f.binding.resolveVisitBinding(initial), 'BINDING_SOURCE_CHANGED');
});
test('persisted history and receipt corruption fail closed', async () => {
  for (const corrupt of [l => { l.histories[VISIT.visitId][0].revision = 9; }, l => { l.histories[VISIT.visitId][0].customerProfileId = '12'; }, l => { l.requests[uuid(11)].recordSha256 = '0'.repeat(64); }, l => { delete l.requests[uuid(11)]; }]) {
    const f = fixture(), request = f.issue(1); await f.binding.applyChange(request); f.corrupt(corrupt); await assert.rejects(f.binding.applyChange(request));
  }
});
test('history validator rejects replaced identity or old record mutation chain', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1)); await f.binding.applyChange(f.issue(2, { action: 'revoke', expectedRevision: 1 }));
  const rows = f.ledger().histories[VISIT.visitId]; rows[1].customerProfileId = '12'; assert.throws(() => validateVisitBindingHistory(rows, VISIT), e => e.code === 'BINDING_SCOPE_IMMUTABLE');
});
test('uncertain post-commit acknowledgment retains exact request and supports safe replay', async () => {
  const f = fixture(), request = f.issue(1); f.state.loseAck = true;
  await rejects(f.binding.applyChange(request), 'BINDING_OUTCOME_UNCERTAIN'); assert.equal(f.ledger().histories[VISIT.visitId].length, 1);
  assert.equal((await f.binding.applyChange(request)).replayed, true); assert.equal(f.ledger().histories[VISIT.visitId].length, 1);
});
test('caller mutation after invocation cannot redirect bound identity or authority request', async () => {
  const f = fixture(), request = f.issue(1), running = f.binding.applyChange(request); request.customerProfileId = '12'; request.visit.visitId = 'booking:102'; request.action = 'revoke';
  await running; assert.equal(f.ledger().histories[VISIT.visitId][0].customerProfileId, '11');
});


test('resolver checks immutable request receipts, not merely valid-shaped binding rows', async () => {
  const f = fixture(); await f.binding.applyChange(f.issue(1));
  f.corrupt(ledger => { ledger.histories[VISIT.visitId][0].customerProfileId = '12'; });
  await rejects(f.binding.resolveVisitBinding(row(f.state)), 'BINDING_RECEIPT_INVALID');
});


test('last authorization-policy wait cannot hide employee revocation at commit or replay', async () => {
  for (const replay of [false, true]) {
    const f = fixture(), request = f.issue(1); if (replay) await f.binding.applyChange(request);
    let commit = false; f.state.beforeCommit = async () => { commit = true; };
    f.state.afterAuthorizeOperator = async () => { if (commit) f.state.staff.reviewer.active = false; };
    await assert.rejects(f.binding.applyChange(request));
    assert.equal((f.ledger().histories[VISIT.visitId] || []).length, replay ? 1 : 0);
  }
});
test('last source/history wait is followed by another employee authorization check', async () => {
  const f = fixture(), request = f.issue(1); let commit = false;
  f.state.beforeCommit = async () => { commit = true; };
  f.state.afterReadHistory = async () => { if (commit) f.state.staff.reviewer.active = false; };
  await assert.rejects(f.binding.applyChange(request)); assert.deepEqual(f.ledger().histories, {});
});


test('approval expiring after consumption but before commit rolls back the new binding', async () => {
  const f = fixture(), request = f.issue(1), original = f.ledger();
  f.state.beforeCommit = async () => { f.state.now += 60001; };
  await rejects(f.binding.applyChange(request), 'BINDING_APPROVAL_EXPIRED'); assert.deepEqual(f.ledger(), original);
});
