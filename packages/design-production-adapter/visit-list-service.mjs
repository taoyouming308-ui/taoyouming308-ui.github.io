/** Server-only authorized day listing. No default I/O or browser identity hints. */
import { createProductionEmployeeAdapter, ProductionEmployeeError, validateProductionDesignScope } from './employee-adapter.mjs';
import { DesignAccessError } from '../design-access-gate/index.mjs';
import { readAuthorizedVisitContext } from './visit-scope-resolver.mjs';

export class VisitListError extends Error {
  constructor(code) { super(code); this.name = 'VisitListError'; this.code = code; }
}
const fail = code => { throw new VisitListError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys, code) => {
  if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(code);
};
const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const same = (a, b) => canonical(a) === canonical(b);
const safeErrors = new Set(['VISIT_LIST_LIMIT_EXCEEDED', 'VISIT_LIST_INVALID_REQUEST', 'VISIT_LIST_INVALID_DATE', 'VISIT_LIST_NOT_CONFIGURED', 'VISIT_LIST_ACCESS_DENIED', 'VISIT_LIST_UNAVAILABLE', 'VISIT_LIST_CHANGED']);

function dateInput(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('VISIT_LIST_INVALID_DATE');
  return value;
}

function locator(value) {
  exact(value, ['assignmentSource', 'visitId'], 'VISIT_LIST_UNAVAILABLE');
  try { validateProductionDesignScope({ customerProfileId: '1', ...value }); }
  catch { fail('VISIT_LIST_UNAVAILABLE'); }
  return freeze({ assignmentSource: value.assignmentSource, visitId: value.visitId });
}

async function actorFor(employee, credential) {
  const authenticated = await employee.authenticate(credential);
  return freeze({ username: authenticated.username, store: authenticated.store });
}

async function displayName(tx, authorized) {
  const profileId = authorized.scope.customerProfileId;
  const profiles = await tx.restRows(`customer_profiles?select=id,name,shop_name&id=eq.${profileId}&limit=2`);
  if (!Array.isArray(profiles) || profiles.length !== 1) fail('VISIT_LIST_UNAVAILABLE');
  const profile = profiles[0];
  exact(profile, ['id', 'name', 'shop_name'], 'VISIT_LIST_UNAVAILABLE');
  if (String(profile.id) !== profileId || profile.shop_name !== authorized.actor.store || !clean(profile.name, 160)) fail('VISIT_LIST_UNAVAILABLE');
  return profile.name;
}

/** Two independent fresh reads; each visit is authorized before reading its name. */
export function createVisitListService({ executor } = {}) {
  async function read(credential, date) {
    let executed = false, checked;
    const returned = await executor.readTransaction(async tx => {
      if (executed) fail('VISIT_LIST_UNAVAILABLE');
      executed = true;
      if (!plain(tx) || ['restRows', 'rpc', 'resolveVisitBinding', 'listAssignedVisits'].some(key => typeof tx[key] !== 'function')) fail('VISIT_LIST_NOT_CONFIGURED');
      const employee = createProductionEmployeeAdapter(tx), actor = await actorFor(employee, credential);
      const sourceRows = await tx.listAssignedVisits(freeze({ actor, date }));
      if (!Array.isArray(sourceRows)) fail('VISIT_LIST_UNAVAILABLE');
      if (sourceRows.length > 50) fail('VISIT_LIST_LIMIT_EXCEEDED');
      const locators = sourceRows.map(locator), seen = new Set(), rows = [];
      for (const visit of locators) {
        if (seen.has(visit.visitId)) fail('VISIT_LIST_UNAVAILABLE');
        seen.add(visit.visitId);
        let authorized;
        try { authorized = await readAuthorizedVisitContext({ tx, credential, visit }); }
        catch (error) {
          // A known explicit absence/ambiguity produces no name, scope or locator.
          // Transport, lifecycle and corrupt authority responses fail the list.
          if (error instanceof ProductionEmployeeError && error.code === 'CUSTOMER_BINDING_REQUIRED') continue;
          throw error;
        }
        if (!same(authorized.actor, actor) || authorized.source.bookingDate !== date) fail('VISIT_LIST_CHANGED');
        rows.push(freeze({ authorized, displayName: await displayName(tx, authorized) }));
      }
      if (!same(await actorFor(employee, credential), actor)) fail('VISIT_LIST_CHANGED');
      // Include the complete bounded source set in comparison even when some
      // rows have no binding. None of these internal locators are projected out.
      checked = freeze({ actor, locators, rows });
      return checked;
    });
    if (!executed || !checked || !same(returned, checked)) fail('VISIT_LIST_UNAVAILABLE');
    return checked;
  }

  return async function listAuthorizedVisits(input) {
    exact(input, ['credential', 'date'], 'VISIT_LIST_INVALID_REQUEST');
    const credential = input.credential, date = dateInput(input.date);
    if (typeof executor?.readTransaction !== 'function') fail('VISIT_LIST_NOT_CONFIGURED');
    try {
      const first = await read(credential, date), latest = await read(credential, date);
      if (!same(first, latest)) fail('VISIT_LIST_CHANGED');
      return freeze({ date, visits: latest.rows.map(({ authorized, displayName }) => ({
        id: authorized.scope.visitId, displayName,
        visit: { assignmentSource: authorized.scope.assignmentSource, visitId: authorized.scope.visitId },
        bindingRevision: authorized.bindingRevision,
      })) });
    } catch (error) {
      if (error instanceof VisitListError && safeErrors.has(error.code)) throw new VisitListError(error.code);
      if (error instanceof ProductionEmployeeError || error instanceof DesignAccessError) {
        if (['AUTHENTICATION_REQUIRED', 'CUSTOMER_VISIT_DENIED', 'RELATIONSHIP_DENIED'].includes(error.code)) fail('VISIT_LIST_ACCESS_DENIED');
        if (['CUSTOMER_BINDING_CHANGED', 'ACTOR_CHANGED'].includes(error.code)) fail('VISIT_LIST_CHANGED');
        if (['EMPLOYEE_ADAPTER_NOT_CONFIGURED', 'ADAPTER_NOT_CONFIGURED'].includes(error.code)) fail('VISIT_LIST_NOT_CONFIGURED');
      }
      fail('VISIT_LIST_UNAVAILABLE');
    }
  };
}
