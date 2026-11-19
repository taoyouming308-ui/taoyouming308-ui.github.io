/** Server-only, injected reads. This module does not read secrets or perform network I/O. */
import { createDesignDiagnostics } from '../shared/design-diagnostics.mjs';
import { createPreparedDesignAccessGate } from '../design-access-gate/index.mjs';
import { customerReadStores, scopeCustomerProfile } from '../../supabase/functions/_shared/customer-profile-scope.mjs';

export class ProductionEmployeeError extends Error {
  constructor(code) { super(code); this.name = 'ProductionEmployeeError'; this.code = code; }
}
const fail = code => { throw new ProductionEmployeeError(code); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const ownKeys = (v, keys) => plain(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const clean = (v, max) => typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integerId = v => typeof v === 'string' && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v));
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const copy = v => JSON.parse(JSON.stringify(v));
const eq = value => encodeURIComponent(JSON.stringify(value));
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('ASSIGNMENT_INVALID');
  return value;
}
export function validateProductionDesignScope(value) {
  if (!ownKeys(value, ['customerProfileId', 'visitId', 'assignmentSource']) || !integerId(value.customerProfileId)) fail('INVALID_SCOPE');
  parseVisit(value.assignmentSource, value.visitId);
  return freeze({ ...value });
}
function parseVisit(source, visitId) {
  if (typeof visitId !== 'string') fail('INVALID_SCOPE');
  if (source === 'appointment' && visitId.startsWith('booking:') && integerId(visitId.slice(8))) return { source, visitId, id: visitId.slice(8) };
  if (source === 'frontdesk' && visitId.startsWith('frontdesk:') && UUID.test(visitId.slice(10))) return { source, visitId, id: visitId.slice(10) };
  fail('INVALID_SCOPE');
}
/**
 * resolveVisitBinding is a TRUSTED server resolver, not a browser field. It must
 * return exactly one current, explicitly verified profile-to-assignment binding.
 * No such mapping is invented from the current bookings/frontdesk phone/name.
 */
export function createProductionEmployeeAdapter(dependencies = {}) {
  const { restRows, rpc, resolveVisitBinding, clock = () => Date.now(), diagnostics } = dependencies;
  const diagnose = createDesignDiagnostics(diagnostics, 'employee');
  function reject(code, phase, kind) { diagnose(phase, 'failure', kind); fail(code); }
  function time() {
    const instant = typeof clock === 'function' ? clock() : NaN;
    if (!Number.isFinite(instant) || !Number.isFinite(new Date(instant).getTime())) fail('CLOCK_INVALID');
    return instant;
  }
  function configured() {
    if (typeof restRows !== 'function' || typeof rpc !== 'function') fail('EMPLOYEE_ADAPTER_NOT_CONFIGURED');
    if (typeof resolveVisitBinding !== 'function') fail('CUSTOMER_BINDING_REQUIRED');
  }
  async function rows(path, code, phase) {
    diagnose(phase, 'start');
    if (typeof restRows !== 'function') fail('EMPLOYEE_ADAPTER_NOT_CONFIGURED');
    let result;
    try { result = await restRows(path); } catch { reject(code, phase, 'dependency'); }
    if (!Array.isArray(result)) reject(code, phase, 'invalid_shape');
    if (result.length !== 1) reject(code, phase, result.length === 0 ? 'missing' : 'ambiguous');
    if (!plain(result[0])) reject(code, phase, 'invalid_shape');
    diagnose(phase, 'success');
    return copy(result[0]);
  }
  async function authenticate(credential) {
    if (typeof restRows !== 'function') fail('EMPLOYEE_ADAPTER_NOT_CONFIGURED');
    // The opaque custom session token is used only here. Never return/log it.
    if (!clean(credential, 200) || credential.length < 32 || /\s/.test(credential)) fail('AUTHENTICATION_REQUIRED');
    const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential)))).map(b => b.toString(16).padStart(2, '0')).join('');
    const session = await rows(`employee_booking_sessions?select=username,store,position,expires_at&token_hash=eq.${digest}&expires_at=gt.${encodeURIComponent(new Date(time()).toISOString())}&limit=2`, 'AUTHENTICATION_REQUIRED', 'session_read');
    const expiresAt = typeof session.expires_at === 'string' ? Date.parse(session.expires_at) : NaN;
    if (!clean(session.username, 80) || !clean(session.store, 100) || !Number.isFinite(expiresAt) || expiresAt <= time()) reject('AUTHENTICATION_REQUIRED', 'session_validate', 'invalid_value');
    diagnose('session_validate', 'success');
    const staff = await rows(`staff?select=username,store,position,active,employment_status&username=eq.${eq(session.username)}&limit=2`, 'AUTHENTICATION_REQUIRED', 'staff_read');
    if (staff.username !== session.username || staff.store !== session.store || staff.active !== true || staff.employment_status !== 'active' || expiresAt <= time()) reject('AUTHENTICATION_REQUIRED', 'staff_validate', 'mismatch');
    try { customerReadStores(staff.store, 'store'); } catch { reject('AUTHENTICATION_REQUIRED', 'staff_validate', 'invalid_value'); }
    diagnose('staff_validate', 'success');
    // Unlike the live endpoint, prepared reads neither renew nor delete sessions.
    return freeze({ username: staff.username, store: staff.store, active: true, expiresAt });
  }
  async function assignment(source, visitId) {
    const visit = parseVisit(source, visitId);
    const path = source === 'appointment'
      ? `bookings?select=id,barber_name,shop_name,date,status&id=eq.${visit.id}&limit=2`
      : `frontdesk_today_customers?select=id,barber_name,store,business_date,status&id=eq.${visit.id}&limit=2`;
    const raw = await rows(path, 'ASSIGNMENT_UNAVAILABLE', 'assignment_read');
    if (String(raw.id) !== visit.id || !clean(raw.barber_name, 80)) reject('ASSIGNMENT_INVALID', 'assignment_validate', 'invalid_value');
    const store = source === 'appointment' ? raw.shop_name : raw.store;
    try { customerReadStores(store, 'store'); } catch { reject('ASSIGNMENT_INVALID', 'assignment_validate', 'invalid_value'); }
    let bookingDate;
    try { bookingDate = date(source === 'appointment' ? raw.date : raw.business_date); } catch (error) { diagnose('assignment_validate', 'failure', 'invalid_value'); throw error; }
    // This import whitelist says nothing about whether service/access is active.
    // resolveVisitBinding must interpret the raw lifecycle/status authoritatively,
    // freshly check revocation, and deny if its meaning cannot be established.
    const admittedStatus = source === 'appointment' ? [0, 1, 3, 4].includes(raw.status) : ['waiting', 'arrived', 'in_service', 'completed'].includes(raw.status);
    if (!admittedStatus) reject('ASSIGNMENT_STATUS_UNSUPPORTED', 'assignment_validate', 'invalid_value');
    diagnose('assignment_validate', 'success');
    return freeze({ source, visitId, id: visit.id, staffUsername: raw.barber_name, store, bookingDate, status: raw.status });
  }
  async function binding(row) {
    if (typeof resolveVisitBinding !== 'function') fail('CUSTOMER_BINDING_REQUIRED');
    let found;
    diagnose('binding_read', 'start');
    try { found = await resolveVisitBinding(freeze(copy(row))); } catch { reject('CUSTOMER_BINDING_UNAVAILABLE', 'binding_read', 'dependency'); }
    if (!Array.isArray(found)) reject('CUSTOMER_BINDING_REQUIRED', 'binding_read', 'invalid_shape');
    if (found.length !== 1) reject('CUSTOMER_BINDING_REQUIRED', 'binding_read', found.length === 0 ? 'missing' : 'ambiguous');
    diagnose('binding_read', 'success');
    const value = found[0];
    const keys = ['assignmentSource', 'visitId', 'customerProfileId', 'store', 'bookingDate', 'visitKey', 'active', 'revision'];
    // active:true is an explicit authoritative lifecycle/access decision from
    // the binding resolver, NEVER derived from the import whitelist above.
    if (!ownKeys(value, keys) || value.assignmentSource !== row.source || value.visitId !== row.visitId || !integerId(value.customerProfileId) || value.store !== row.store || value.bookingDate !== row.bookingDate || value.active !== true || !clean(value.revision, 160)) reject('CUSTOMER_BINDING_INVALID', 'binding_validate', 'mismatch');
    // Frontdesk UUID remains distinct even for two visits on the same day.
    const key = row.source === 'appointment' ? row.visitId : `manual:${row.bookingDate}:${row.id}`;
    if (value.visitKey !== key) reject('CUSTOMER_BINDING_INVALID', 'binding_validate', 'mismatch');
    diagnose('binding_validate', 'success');
    return freeze(copy(value));
  }
  async function resolveAssignment(query) {
    configured();
    if (!ownKeys(query, ['source', 'visitId'])) fail('INVALID_SCOPE');
    const row = await assignment(query.source, query.visitId), bound = await binding(row);
    return freeze({ source: row.source, visitId: row.visitId, customerProfileId: bound.customerProfileId, staffUsername: row.staffUsername, store: row.store, active: true });
  }
  async function contextFor(scope, store) {
    const row = await assignment(scope.assignmentSource, scope.visitId), bound = await binding(row);
    if (row.store !== store || bound.customerProfileId !== scope.customerProfileId) reject('CUSTOMER_VISIT_DENIED', 'profile_validate', 'mismatch');
    const profile = await rows(`customer_profiles?select=id,shop_name,card_packages,service_history&id=eq.${scope.customerProfileId}&limit=2`, 'CUSTOMER_VISIT_DENIED', 'profile_read');
    if (String(profile.id) !== scope.customerProfileId || profile.shop_name !== store || !scopeCustomerProfile(profile, store, 'store')) reject('CUSTOMER_VISIT_DENIED', 'profile_validate', 'mismatch');
    diagnose('profile_validate', 'success');
    let resolved;
    const bookingId = row.source === 'appointment' ? Number(row.id) : null;
    diagnose('context_rpc', 'start');
    try { resolved = await rpc('customer_design_resolve_context', freeze({ p_customer_profile_id: Number(scope.customerProfileId), p_booking_id: bookingId, p_booking_date: row.bookingDate, p_visit_key: bound.visitKey })); }
    catch { reject('CUSTOMER_VISIT_DENIED', 'context_rpc', 'dependency'); }
    diagnose('context_rpc', 'success');
    // The shared RPC additionally verifies the actual profile/booking identity.
    // It is not the primary binding, and returned phone/name are not propagated.
    if (!plain(resolved) || String(resolved.customer_profile_id) !== scope.customerProfileId || resolved.booking_id !== bookingId || resolved.booking_date !== row.bookingDate || resolved.visit_key !== bound.visitKey || resolved.store !== store) reject('CUSTOMER_VISIT_DENIED', 'context_validate', 'mismatch');
    diagnose('context_validate', 'success');
    return freeze({ context: { customer_profile_id: Number(scope.customerProfileId), booking_id: bookingId, booking_date: row.bookingDate, visit_key: bound.visitKey, store }, bindingRevision: bound.revision });
  }
  async function resolveCustomerVisit(query) {
    configured();
    if (!ownKeys(query, ['customerProfileId', 'visitId', 'assignmentSource', 'store'])) fail('INVALID_SCOPE');
    const { store, ...input } = query, scope = validateProductionDesignScope(input);
    await contextFor(scope, store);
    return freeze({ ...scope, store, unambiguous: true });
  }
  const prepared = createPreparedDesignAccessGate({ authenticate, resolveAssignment, resolveCustomerVisit, now: time, diagnostics });
  function preflight(scope) { configured(); return validateProductionDesignScope(scope); }
  const gate = freeze({
    async authorize(credential, scope) { return prepared.authorize(credential, preflight(scope)); },
    async withAuthorizedRead({ credential, scope }, read) { return prepared.withAuthorizedRead({ credential, scope: preflight(scope) }, read); },
    async createCommitGuard({ credential, scope }) { return prepared.createCommitGuard({ credential, scope: preflight(scope) }); },
  });
  async function resolveArchiveContext({ credential, scope }) {
    const fixed = preflight(scope);
    return gate.withAuthorizedRead({ credential, scope: fixed }, async grant => {
      const first = await contextFor(fixed, grant.actor.store);
      const latest = await contextFor(fixed, grant.actor.store);
      if (JSON.stringify(first) !== JSON.stringify(latest)) fail('CUSTOMER_BINDING_CHANGED');
      return freeze({ ...grant, ...first });
    });
  }
  return freeze({ authenticate, gate, resolveArchiveContext });
}
