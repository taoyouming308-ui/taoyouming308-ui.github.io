import { createDesignDiagnostics } from '../shared/design-diagnostics.mjs';
/** Offline-reviewed server binding logic. No default I/O, lifecycle policy or permission. */
import { createHash } from 'node:crypto';
import { createProductionEmployeeAdapter, validateProductionDesignScope } from './employee-adapter.mjs';
export const VISIT_BINDING_SCHEMA = 'design-visit-binding-v1';
export class VisitBindingError extends Error {
  constructor(code) { super(code); this.name = 'VisitBindingError'; this.code = code; }
}
const fail = code => { throw new VisitBindingError(code); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => { if (!plain(v) || Object.keys(v).sort().join('|') !== [...keys].sort().join('|')) fail('BINDING_INVALID_FIELDS'); };
const text = (v, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const clone = v => JSON.parse(canonical(v));
const same = (a, b) => canonical(a) === canonical(b);
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const STORES = ['自由手艺人', '向里造型'];
const ACTIONS = ['bind', 'reassign', 'revoke', 'restore'];
const ROW_KEYS = ['source', 'visitId', 'id', 'staffUsername', 'store', 'bookingDate', 'status'];
const RECORD_KEYS = ['schemaVersion', 'visit', 'revision', 'previousRevision', 'requestId', 'action', 'state', 'customerProfileId', 'store', 'bookingDate', 'visitKey', 'staffUsername', 'actor', 'authorityReceiptId', 'sourceStatus', 'policyRevision', 'createdAt'];
function locator(input) {
  exact(input, ['assignmentSource', 'visitId']);
  try { validateProductionDesignScope({ customerProfileId: '1', ...input }); } catch { fail('BINDING_INVALID_VISIT'); }
  return freeze({ ...input });
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('BINDING_INVALID_DATE');
  return value;
}
function actor(value) {
  exact(value, ['username', 'store']);
  if (!text(value.username, 80) || !STORES.includes(value.store)) fail('BINDING_INVALID_ACTOR');
}
function profile(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('BINDING_INVALID_PROFILE');
}
function status(value) {
  if (!(Number.isSafeInteger(value) || text(value, 40))) fail('BINDING_INVALID_STATUS');
}
function validateRow(value) {
  exact(value, ROW_KEYS);
  const visit = locator({ assignmentSource: value.source, visitId: value.visitId });
  const id = visit.visitId.slice(visit.assignmentSource === 'appointment' ? 8 : 10);
  if (value.id !== id || !text(value.staffUsername, 80) || !STORES.includes(value.store)) fail('BINDING_SOURCE_MISMATCH');
  date(value.bookingDate); status(value.status);
  return freeze(clone(value));
}
function visitKey(visit, bookingDate) {
  return visit.assignmentSource === 'appointment' ? visit.visitId : `manual:${bookingDate}:${visit.visitId.slice(10)}`;
}
function transition(previous, next) {
  if (!previous) { if (next.action !== 'bind') fail('BINDING_TRANSITION_INVALID'); return; }
  if (next.action === 'bind' || !same(previous.visit, next.visit) || ['customerProfileId', 'store', 'bookingDate', 'visitKey'].some(k => previous[k] !== next[k])) fail('BINDING_SCOPE_IMMUTABLE');
  if (next.action === 'revoke' && (previous.state !== 'active' || next.staffUsername !== previous.staffUsername)) fail('BINDING_TRANSITION_INVALID');
  if (next.action === 'restore' && (previous.state !== 'revoked' || next.staffUsername !== previous.staffUsername)) fail('BINDING_TRANSITION_INVALID');
  if (next.action === 'reassign' && next.staffUsername === previous.staffUsername) fail('BINDING_TRANSITION_INVALID');
}
/** Audit history is append-only; current authorization must still consult current source/policy. */
export function validateVisitBindingHistory(input, requestedVisit) {
  const visit = locator(requestedVisit);
  if (!Array.isArray(input) || input.length > 256) fail('BINDING_HISTORY_INVALID');
  const seen = new Set(); let prior = null;
  for (const row of input) {
    exact(row, RECORD_KEYS); locator(row.visit); actor(row.actor); profile(row.customerProfileId); date(row.bookingDate);
    if (row.schemaVersion !== VISIT_BINDING_SCHEMA || !same(row.visit, visit) || row.revision !== (prior?.revision || 0) + 1 || row.previousRevision !== (prior?.revision || 0) || !UUID.test(row.requestId) || seen.has(row.requestId) || !ACTIONS.includes(row.action) || row.state !== (row.action === 'revoke' ? 'revoked' : 'active') || !STORES.includes(row.store) || row.actor.store !== row.store || !text(row.staffUsername, 80) || row.visitKey !== visitKey(visit, row.bookingDate) || !text(row.authorityReceiptId) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || (prior && row.createdAt < prior.createdAt)) fail('BINDING_HISTORY_INVALID');
    if (row.action === 'revoke') { if (row.policyRevision !== null || row.sourceStatus !== null) fail('BINDING_HISTORY_INVALID'); }
    else { status(row.sourceStatus); if (!text(row.policyRevision)) fail('BINDING_HISTORY_INVALID'); }
    transition(prior, row); seen.add(row.requestId); prior = row;
  }
  return freeze(clone(input));
}
function requireMethods(tx, methods) {
  if (!plain(tx) || methods.some(k => typeof tx[k] !== 'function')) fail('BINDING_TRANSACTION_NOT_CONFIGURED');
}
async function one(tx, path) {
  let rows; try { rows = await tx.restRows(path); } catch { fail('BINDING_SOURCE_UNAVAILABLE'); }
  if (!Array.isArray(rows) || rows.length !== 1 || !plain(rows[0])) fail('BINDING_SOURCE_AMBIGUOUS');
  return clone(rows[0]);
}
async function assignment(tx, visit) {
  const id = visit.visitId.slice(visit.assignmentSource === 'appointment' ? 8 : 10);
  const raw = await one(tx, visit.assignmentSource === 'appointment'
    ? `bookings?select=id,barber_name,shop_name,date,status&id=eq.${id}&limit=2`
    : `frontdesk_today_customers?select=id,barber_name,store,business_date,status&id=eq.${id}&limit=2`);
  return validateRow({ source: visit.assignmentSource, visitId: visit.visitId, id: String(raw.id), staffUsername: raw.barber_name,
    store: visit.assignmentSource === 'appointment' ? raw.shop_name : raw.store, bookingDate: visit.assignmentSource === 'appointment' ? raw.date : raw.business_date, status: raw.status });
}
async function lifecycle(tx, row) {
  let result; try { result = await tx.evaluateLifecycle(row); } catch { fail('BINDING_LIFECYCLE_UNCONFIRMED'); }
  exact(result, ['allowed', 'policyRevision']);
  if (result.allowed !== true || !text(result.policyRevision)) fail('BINDING_LIFECYCLE_UNCONFIRMED');
  return freeze(clone(result));
}
async function verifyTarget(tx, row, customerProfileId) {
  const staff = await one(tx, `staff?select=username,store,active,employment_status&username=eq.${encodeURIComponent(JSON.stringify(row.staffUsername))}&limit=2`);
  if (staff.username !== row.staffUsername || staff.store !== row.store || staff.active !== true || staff.employment_status !== 'active') fail('BINDING_STYLIST_INACTIVE');
  const p = await one(tx, `customer_profiles?select=id,shop_name&id=eq.${customerProfileId}&limit=2`);
  if (String(p.id) !== customerProfileId || p.shop_name !== row.store) fail('BINDING_PROFILE_MISMATCH');
  const visit = { assignmentSource: row.source, visitId: row.visitId }, key = visitKey(visit, row.bookingDate);
  const args = { p_customer_profile_id: Number(customerProfileId), p_booking_id: row.source === 'appointment' ? Number(row.id) : null, p_booking_date: row.bookingDate, p_visit_key: key };
  let c; try { c = await tx.rpc('customer_design_resolve_context', freeze(args)); } catch { fail('BINDING_PROFILE_MISMATCH'); }
  if (!plain(c) || c.customer_profile_id !== Number(customerProfileId) || c.booking_id !== args.p_booking_id || c.booking_date !== row.bookingDate || c.visit_key !== key || c.store !== row.store) fail('BINDING_PROFILE_MISMATCH');
}
async function history(tx, visit) {
  const rows = validateVisitBindingHistory(await tx.readBindingHistory(visit), visit);
  // The resolver must not turn a structurally valid but altered old mapping into
  // authority. Rebind each immutable version to its atomic request receipt.
  for (const record of rows) {
    const command = { requestId: record.requestId, expectedRevision: record.previousRevision, action: record.action, visit: record.visit, customerProfileId: record.customerProfileId };
    const expected = { requestId: record.requestId, actor: record.actor, visit: record.visit, commandSha256: digest({ actor: record.actor, command }), appliedRevision: record.revision, recordSha256: digest(record) };
    if (!same(await tx.readRequest(record.requestId), expected)) fail('BINDING_RECEIPT_INVALID');
  }
  return rows;
}
function result(request, applied, current, replayed) {
  return freeze({ requestId: request.requestId, visit: request.visit, appliedRevision: applied, currentRevision: current, replayed });
}
/**
 * Both executors are server-owned transaction boundaries, NOT browser input or
 * Promise mutexes. No default implementation/policy/approval resolver is installed.
 */
export function createVisitBindingAdapter({ readTransaction, writeTransaction, clock = () => Date.now(), diagnostics } = {}) {
  const diagnose = createDesignDiagnostics(diagnostics, 'visit_binding');
  async function observed(phase, work) { diagnose(phase, 'start'); try { const value = await work(); diagnose(phase, 'success'); return value; } catch (error) { diagnose(phase, 'failure', error instanceof VisitBindingError ? 'unknown' : 'dependency'); throw error; } }
  const now = () => { const n = clock(); if (!Number.isSafeInteger(n) || n < 0) fail('BINDING_CLOCK_INVALID'); return n; };
  const READ = ['restRows', 'rpc', 'readBindingHistory', 'readRequest', 'evaluateLifecycle'];
  async function resolveVisitBinding(input) {
    if (typeof readTransaction !== 'function') fail('BINDING_TRANSACTION_NOT_CONFIGURED');
    const requestedRow = validateRow(input), visit = locator({ assignmentSource: input.source, visitId: input.visitId });
    let executed = false, expected;
    try {
      const returned = await observed('transaction', () => readTransaction(async tx => {
        if (executed) fail('BINDING_TRANSACTION_REENTRY'); executed = true; requireMethods(tx, READ);
        const first = await observed('history', () => history(tx, visit)), head = first.at(-1);
        if (!head || head.state !== 'active') return (expected = []);
        const current = await observed('assignment', () => assignment(tx, visit));
        if (!same(current, requestedRow) || ['staffUsername', 'store', 'bookingDate'].some(k => current[k] !== head[k])) { diagnose('final_consistency', 'failure', 'mismatch'); fail('BINDING_SOURCE_CHANGED'); }
        const policy = await observed('lifecycle', () => lifecycle(tx, current)); await observed('profile_context', () => verifyTarget(tx, current, head.customerProfileId));
        const latest = await observed('assignment', () => assignment(tx, visit)), latestPolicy = await observed('lifecycle', () => lifecycle(tx, latest)), latestHistory = await observed('history', () => history(tx, visit));
        if (!same(current, latest) || !same(policy, latestPolicy) || !same(first, latestHistory)) { diagnose('final_consistency', 'failure', 'mismatch'); fail('BINDING_SOURCE_CHANGED'); }
        diagnose('final_consistency', 'success');
        expected = [{ assignmentSource: visit.assignmentSource, visitId: visit.visitId, customerProfileId: head.customerProfileId, store: head.store,
          bookingDate: head.bookingDate, visitKey: head.visitKey, active: true, revision: `binding:${head.revision}` }];
        return freeze(clone(expected));
      }));
      if (!executed || !same(returned, expected)) fail('BINDING_READ_UNAVAILABLE');
      return freeze(clone(returned));
    } catch (error) { if (error instanceof VisitBindingError) throw error; fail('BINDING_READ_UNAVAILABLE'); }
  }
  async function applyChange(request) {
    if (typeof writeTransaction !== 'function') fail('BINDING_TRANSACTION_NOT_CONFIGURED');
    exact(request, ['credential', 'requestId', 'expectedRevision', 'action', 'visit', 'customerProfileId', 'approval']);
    if (!UUID.test(request.requestId) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || !ACTIONS.includes(request.action) || !text(request.approval, 512)) fail('BINDING_INVALID_REQUEST');
    const visit = locator(request.visit); profile(request.customerProfileId);
    const fixed = freeze({ requestId: request.requestId, expectedRevision: request.expectedRevision, action: request.action, visit, customerProfileId: request.customerProfileId });
    const credential = request.credential, approval = request.approval;
    let executed = false, guarded = false, checked;
    try {
      const returned = await writeTransaction(async tx => {
        if (executed) fail('BINDING_TRANSACTION_REENTRY'); executed = true;
        requireMethods(tx, [...READ, 'readRequest', 'authorizeOperator', 'consumeApproval', 'appendVersion', 'beforeCommit']);
        const employee = createProductionEmployeeAdapter({ restRows: tx.restRows, clock: now });
        const authenticated = await employee.authenticate(credential), who = freeze({ username: authenticated.username, store: authenticated.store });
        const first = await history(tx, visit), prior = first.at(-1), commandSha256 = digest({ actor: who, command: fixed });
        async function checkOperator() {
          const user = await employee.authenticate(credential);
          if (!same(who, { username: user.username, store: user.store })) fail('BINDING_ACTOR_CHANGED');
          let yes; try { yes = await tx.authorizeOperator(freeze({ actor: who, action: fixed.action, visit, customerProfileId: fixed.customerProfileId })); } catch { fail('BINDING_OPERATOR_DENIED'); }
          if (yes !== true) fail('BINDING_OPERATOR_DENIED');
          const latest = await employee.authenticate(credential);
          if (!same(who, { username: latest.username, store: latest.store })) fail('BINDING_ACTOR_CHANGED');
        }
        await checkOperator();
        const receipt = await tx.readRequest(fixed.requestId);
        if (receipt !== null) {
          exact(receipt, ['requestId', 'actor', 'visit', 'commandSha256', 'appliedRevision', 'recordSha256']);
          const old = first[receipt.appliedRevision - 1];
          if (receipt.requestId !== fixed.requestId || !same(receipt.actor, who) || !same(receipt.visit, visit) || receipt.commandSha256 !== commandSha256 || !SHA.test(receipt.recordSha256) || !old || old.requestId !== fixed.requestId || digest(old) !== receipt.recordSha256) fail('BINDING_REQUEST_CONFLICT');
          await checkOperator();
          await tx.beforeCommit(async () => { await checkOperator(); guarded = true; });
          checked = result(fixed, receipt.appliedRevision, first.length, true); return checked;
        }
        if (first.some(row => row.requestId === fixed.requestId)) fail('BINDING_RECEIPT_MISSING');
        if ((prior?.revision || 0) !== fixed.expectedRevision) fail('BINDING_REVISION_CONFLICT');
        if (first.length >= 256) fail('BINDING_HISTORY_LIMIT');
        let current = null, policy = null;
        if (fixed.action !== 'revoke') {
          current = await assignment(tx, visit); policy = await lifecycle(tx, current); await verifyTarget(tx, current, fixed.customerProfileId);
        } else if (!prior) fail('BINDING_NOT_FOUND');
        const basis = current || prior;
        if (basis.store !== who.store) fail('BINDING_STORE_DENIED');
        const draft = {
          schemaVersion: VISIT_BINDING_SCHEMA, visit, revision: fixed.expectedRevision + 1, previousRevision: fixed.expectedRevision,
          requestId: fixed.requestId, action: fixed.action, state: fixed.action === 'revoke' ? 'revoked' : 'active', customerProfileId: fixed.customerProfileId,
          store: basis.store, bookingDate: basis.bookingDate, visitKey: visitKey(visit, basis.bookingDate), staffUsername: basis.staffUsername,
          actor: who, authorityReceiptId: 'pending', sourceStatus: current?.status ?? null, policyRevision: policy?.policyRevision ?? null, createdAt: now(),
        };
        validateVisitBindingHistory([...first, draft], visit);
        const intent = freeze({ actor: who, command: fixed, previousRevision: prior?.revision || 0, previousState: prior?.state || null,
          target: { customerProfileId: draft.customerProfileId, store: draft.store, bookingDate: draft.bookingDate, visitKey: draft.visitKey, staffUsername: draft.staffUsername },
          sourceStatus: draft.sourceStatus, policyRevision: draft.policyRevision });
        let consent; try { consent = await tx.consumeApproval(freeze({ approval, intent, intentSha256: digest(intent) })); } catch { fail('BINDING_APPROVAL_REQUIRED'); }
        exact(consent, ['receiptId', 'intentSha256', 'expiresAt']);
        if (!text(consent.receiptId) || consent.intentSha256 !== digest(intent) || !Number.isSafeInteger(consent.expiresAt) || consent.expiresAt <= now()) fail('BINDING_APPROVAL_REQUIRED');
        const record = freeze({ ...draft, authorityReceiptId: consent.receiptId });
        const nextHistory = validateVisitBindingHistory([...first, record], visit);
        async function checkSource(expectedHistory) {
          if (consent.expiresAt <= now()) fail('BINDING_APPROVAL_EXPIRED');
          await checkOperator();
          if (current) {
            const latest = await assignment(tx, visit), latestPolicy = await lifecycle(tx, latest);
            await verifyTarget(tx, latest, fixed.customerProfileId);
            if (!same(current, latest) || !same(policy, latestPolicy)) fail('BINDING_SOURCE_CHANGED');
          }
          if (!same(await history(tx, visit), expectedHistory)) fail('BINDING_REVISION_CONFLICT');
          await checkOperator(); // Also cover revocation during intervening source/RPC waits.
          if (consent.expiresAt <= now()) fail('BINDING_APPROVAL_EXPIRED');
        }
        await checkSource(first);
        const nextReceipt = freeze({ requestId: fixed.requestId, actor: who, visit, commandSha256, appliedRevision: record.revision, recordSha256: digest(record) });
        const accepted = await tx.appendVersion(freeze({ expectedRevision: fixed.expectedRevision, record, receipt: nextReceipt }));
        if (accepted !== true) fail('BINDING_REVISION_CONFLICT');
        await checkSource(nextHistory);
        await tx.beforeCommit(async () => { await checkSource(nextHistory); guarded = true; });
        checked = result(fixed, record.revision, record.revision, false); return checked;
      });
      if (!executed || !guarded || !same(returned, checked)) fail('BINDING_OUTCOME_UNCERTAIN');
      return freeze(clone(returned));
    } catch (error) {
      if (error instanceof VisitBindingError || error?.name === 'ProductionEmployeeError') throw error;
      fail('BINDING_OUTCOME_UNCERTAIN');
    }
  }
  return freeze({ resolveVisitBinding, applyChange });
}
