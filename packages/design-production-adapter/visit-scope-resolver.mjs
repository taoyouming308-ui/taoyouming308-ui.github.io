/** Server-only, read-only visit lookup. No default I/O, identity hint or binding policy. */
import { createProductionEmployeeAdapter, ProductionEmployeeError, validateProductionDesignScope } from './employee-adapter.mjs';

const fail = code => { throw new ProductionEmployeeError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys, code = 'INVALID_SCOPE') => {
  if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(code);
};
const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const same = (a, b) => canonical(a) === canonical(b);
const safeErrors = new Set(['INVALID_SCOPE', 'EMPLOYEE_ADAPTER_NOT_CONFIGURED', 'AUTHENTICATION_REQUIRED', 'CLOCK_INVALID', 'ASSIGNMENT_UNAVAILABLE', 'ASSIGNMENT_INVALID', 'ASSIGNMENT_STATUS_UNSUPPORTED', 'CUSTOMER_VISIT_DENIED', 'CUSTOMER_BINDING_UNAVAILABLE', 'CUSTOMER_BINDING_REQUIRED', 'CUSTOMER_BINDING_INVALID', 'CUSTOMER_BINDING_CHANGED']);

function visitLocator(input) {
  exact(input, ['assignmentSource', 'visitId']);
  // The fixed profile is ONLY a parser sentinel, never an authorization candidate.
  validateProductionDesignScope({ customerProfileId: '1', ...input });
  return freeze({ assignmentSource: input.assignmentSource, visitId: input.visitId });
}

async function assignment(tx, visit, actor) {
  const appointment = visit.assignmentSource === 'appointment';
  const id = visit.visitId.slice(appointment ? 8 : 10);
  let rows;
  try {
    rows = await tx.restRows(appointment
      ? `bookings?select=id,barber_name,shop_name,date,status&id=eq.${id}&limit=2`
      : `frontdesk_today_customers?select=id,barber_name,store,business_date,status&id=eq.${id}&limit=2`);
  } catch { fail('ASSIGNMENT_UNAVAILABLE'); }
  if (!Array.isArray(rows) || rows.length !== 1 || !plain(rows[0])) fail('ASSIGNMENT_UNAVAILABLE');
  const raw = rows[0], store = appointment ? raw.shop_name : raw.store, bookingDate = appointment ? raw.date : raw.business_date;
  if (String(raw.id) !== id || raw.barber_name !== actor.username || store !== actor.store) fail('CUSTOMER_VISIT_DENIED');
  if (typeof bookingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !Number.isFinite(Date.parse(bookingDate + 'T00:00:00Z')) || new Date(bookingDate + 'T00:00:00Z').toISOString().slice(0, 10) !== bookingDate) fail('ASSIGNMENT_INVALID');
  // Admitted import statuses are not lifecycle permission. The binding resolver
  // must independently enforce current approved lifecycle and revocation rules.
  if (!(appointment ? [0, 1, 3, 4].includes(raw.status) : ['waiting', 'arrived', 'in_service', 'completed'].includes(raw.status))) fail('ASSIGNMENT_STATUS_UNSUPPORTED');
  return freeze({ source: visit.assignmentSource, visitId: visit.visitId, id, staffUsername: actor.username, store, bookingDate, status: raw.status });
}

/** One complete authorized read on an existing trusted transaction; never opens a nested lease. */
export async function readAuthorizedVisitContext({ tx, credential, visit: input, expectedBindingRevision }) {
  const visit = visitLocator(input);
  if (expectedBindingRevision !== undefined && !clean(expectedBindingRevision, 160)) fail('INVALID_SCOPE');
  if (!plain(tx) || ['restRows', 'rpc', 'resolveVisitBinding'].some(key => typeof tx[key] !== 'function')) fail('EMPLOYEE_ADAPTER_NOT_CONFIGURED');
  const employee = createProductionEmployeeAdapter(tx);
  const authenticated = await employee.authenticate(credential);
  const actor = freeze({ username: authenticated.username, store: authenticated.store });
  const row = await assignment(tx, visit, actor);
  let bindings;
  try { bindings = await tx.resolveVisitBinding(row); } catch { fail('CUSTOMER_BINDING_UNAVAILABLE'); }
  // Only explicit absence/ambiguity may be omitted from a day list. A malformed
  // authority response is corruption, not an empty authorized result.
  if (!Array.isArray(bindings)) fail('CUSTOMER_BINDING_INVALID');
  if (bindings.length !== 1) fail('CUSTOMER_BINDING_REQUIRED');
  const bound = bindings[0];
  exact(bound, ['assignmentSource', 'visitId', 'customerProfileId', 'store', 'bookingDate', 'visitKey', 'active', 'revision'], 'CUSTOMER_BINDING_INVALID');
  const visitKey = row.source === 'appointment' ? row.visitId : `manual:${row.bookingDate}:${row.id}`;
  if (bound.assignmentSource !== row.source || bound.visitId !== row.visitId || bound.store !== row.store || bound.bookingDate !== row.bookingDate || bound.visitKey !== visitKey || bound.active !== true || !clean(bound.revision, 160)) fail('CUSTOMER_BINDING_INVALID');
  if (expectedBindingRevision !== undefined && bound.revision !== expectedBindingRevision) fail('CUSTOMER_BINDING_CHANGED');
  const scope = validateProductionDesignScope({ customerProfileId: bound.customerProfileId, ...visit });
  // Reuses the real gate, profile/store checks and shared customer-context RPC.
  // Its delayed-read rechecks also detect actor changes within this transaction.
  const resolved = await employee.resolveArchiveContext({ credential, scope });
  if (!same(resolved.actor, actor) || !same(resolved.scope, scope) || resolved.bindingRevision !== bound.revision || resolved.context.booking_date !== row.bookingDate || resolved.context.visit_key !== visitKey) fail('CUSTOMER_BINDING_CHANGED');
  return freeze({ actor, scope, source: row, context: resolved.context, bindingRevision: resolved.bindingRevision });
}

/**
 * Trusted executor.readTransaction supplies the actual existing employee adapter
 * dependencies, including authoritative tx.resolveVisitBinding. No write path is
 * used. Returned scope is a lookup result, never a lasting authorization grant.
 */
export function createVisitScopeResolver({ executor } = {}) {
  async function read(credential, visit, expectedBindingRevision) {
    let executed = false, checked;
    const returned = await executor.readTransaction(async tx => {
      if (executed) fail('CUSTOMER_BINDING_UNAVAILABLE');
      executed = true;
      checked = await readAuthorizedVisitContext({ tx, credential, visit, expectedBindingRevision });
      return checked;
    });
    if (!executed || !checked || !same(returned, checked)) fail('CUSTOMER_BINDING_UNAVAILABLE');
    return checked;
  }
  return async function resolveVisitScope(input) {
    const hasExpected = plain(input) && Object.hasOwn(input, 'expectedBindingRevision');
    exact(input, hasExpected ? ['credential', 'visit', 'expectedBindingRevision'] : ['credential', 'visit']);
    const credential = input.credential, visit = visitLocator(input.visit), expectedBindingRevision = input.expectedBindingRevision;
    if (hasExpected && !clean(expectedBindingRevision, 160)) fail('INVALID_SCOPE');
    if (typeof executor?.readTransaction !== 'function') fail('EMPLOYEE_ADAPTER_NOT_CONFIGURED');
    try {
      const first = await read(credential, visit, expectedBindingRevision);
      // Independent lease/transaction after the first has released its locks.
      // Never reuse the earlier snapshot after reassignment, revocation or expiry.
      const latest = await read(credential, visit, expectedBindingRevision);
      if (!same(first, latest)) fail('CUSTOMER_BINDING_CHANGED');
      return freeze({ scope: latest.scope });
    } catch (error) {
      // No database diagnostics, raw dependency errors, names, phones or tokens.
      if (error instanceof ProductionEmployeeError && safeErrors.has(error.code)) throw new ProductionEmployeeError(error.code);
      fail('CUSTOMER_BINDING_UNAVAILABLE');
    }
  };
}
