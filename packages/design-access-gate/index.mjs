import { createDesignDiagnostics } from '../shared/design-diagnostics.mjs';
/** Prepared server-only policy adapter. No I/O, token storage, database or live wiring. */
export class DesignAccessError extends Error {
  constructor(code) { super(code); this.name='DesignAccessError'; this.code=code; }
}
const fail = code => { throw new DesignAccessError(code); };
const plain = value => value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
function exact(value, keys) {
  if(!plain(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|')) fail('INVALID_SCOPE');
}
function identifier(value) {
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>160||/[\u0000-\u001f]/.test(value)) fail('INVALID_SCOPE');
  return value;
}
function requestedScope(value) {
  exact(value,['customerProfileId','visitId','assignmentSource']);
  identifier(value.customerProfileId); identifier(value.visitId);
  if(!['appointment','frontdesk'].includes(value.assignmentSource)) fail('INVALID_SCOPE');
  return Object.freeze({...value});
}
/**
 * Trusted dependencies must perform authoritative server reads. Browser objects,
 * usernames, store claims and mock actor headers must never implement them.
 * A ticket never grants lasting access: every guard call re-reads all sources.
 */
export function createPreparedDesignAccessGate(dependencies={}) {
  const {authenticate,resolveAssignment,resolveCustomerVisit,now=()=>Date.now(),diagnostics}=dependencies;
  const diagnose=createDesignDiagnostics(diagnostics,'access_gate');
  const ready = [authenticate,resolveAssignment,resolveCustomerVisit,now].every(fn=>typeof fn==='function');
  async function authorize(credential, requested) {
    if(!ready) fail('ADAPTER_NOT_CONFIGURED');
    const scope=requestedScope(requested);
    // Opaque credential passes only to the injected verifier, never to resolvers/output.
    let employee;
    diagnose('authenticate','start');
    try { employee=await authenticate(credential); } catch { diagnose('authenticate','failure','dependency'); fail('AUTHENTICATION_REQUIRED'); }
    const instant=now();
    if(!plain(employee)||employee.active!==true||typeof employee.username!=='string'||!employee.username.trim()||
       typeof employee.store!=='string'||!employee.store.trim()||!Number.isFinite(employee.expiresAt)||
       !Number.isFinite(instant)||employee.expiresAt<=instant) {diagnose('authenticate','failure','invalid_value');fail('AUTHENTICATION_REQUIRED');}
    diagnose('authenticate','success');
    const actor=Object.freeze({username:employee.username,store:employee.store});
    let assignment, resolved;
    diagnose('assignment','start');
    try { assignment=await resolveAssignment(Object.freeze({source:scope.assignmentSource,visitId:scope.visitId})); }
    catch { diagnose('assignment','failure','dependency'); fail('RELATIONSHIP_UNAVAILABLE'); }
    diagnose('assignment','success');diagnose('customer_visit','start');
    try { resolved=await resolveCustomerVisit(Object.freeze({...scope,store:actor.store})); }
    catch { diagnose('customer_visit','failure','dependency'); fail('RELATIONSHIP_UNAVAILABLE'); }
    diagnose('customer_visit','success');
    if(!plain(assignment)||assignment.active!==true||assignment.source!==scope.assignmentSource||
       assignment.visitId!==scope.visitId||assignment.customerProfileId!==scope.customerProfileId||
       assignment.staffUsername!==actor.username||assignment.store!==actor.store) {diagnose('assignment','failure','mismatch');fail('RELATIONSHIP_DENIED');}
    if(!plain(resolved)||resolved.unambiguous!==true||resolved.customerProfileId!==scope.customerProfileId||
       resolved.visitId!==scope.visitId||resolved.assignmentSource!==scope.assignmentSource||resolved.store!==actor.store) {diagnose('customer_visit','failure','mismatch');fail('CUSTOMER_VISIT_DENIED');}
    const completedAt=now();
    if(!Number.isFinite(completedAt)||employee.expiresAt<=completedAt) {diagnose('final_expiry','failure','expired');fail('AUTHENTICATION_REQUIRED');}
    diagnose('final_expiry','success');
    return Object.freeze({actor,scope});
  }
  async function withAuthorizedRead({credential,scope},read) {
    if(typeof read!=='function') fail('INVALID_OPERATION');
    const fixed=requestedScope(scope);
    const grant=await authorize(credential,fixed);
    const result=await read(grant);
    const latest=await authorize(credential,fixed);
    if(latest.actor.username!==grant.actor.username||latest.actor.store!==grant.actor.store) fail('ACTOR_CHANGED');
    return result;
  }
  async function createCommitGuard({credential,scope}) {
    const fixed=requestedScope(scope);
    const grant=await authorize(credential,fixed);
    return Object.freeze({grant,async recheck(){
      const latest=await authorize(credential,fixed);
      if(latest.actor.username!==grant.actor.username||latest.actor.store!==grant.actor.store) fail('ACTOR_CHANGED');
      return latest;
    }});
  }
  return Object.freeze({authorize,withAuthorizedRead,createCommitGuard});
}
