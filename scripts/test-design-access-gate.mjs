import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedDesignAccessGate} from '../packages/design-access-gate/index.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden');};
const scope=Object.freeze({customerProfileId:'synthetic-profile-a',visitId:'synthetic-visit-a',assignmentSource:'appointment'});
const credential=Symbol('opaque synthetic authentication proof');
function fixture(){
  const state={employee:{username:'synthetic-a',store:'synthetic-store',active:true,expiresAt:2000},assignment:{source:'appointment',visitId:scope.visitId,customerProfileId:scope.customerProfileId,staffUsername:'synthetic-a',store:'synthetic-store',active:true},resolved:{...scope,store:'synthetic-store',unambiguous:true},calls:[]};
  const gate=createPreparedDesignAccessGate({now:()=>1000,authenticate:async value=>{assert.equal(value,credential);state.calls.push('auth');return {...state.employee};},resolveAssignment:async query=>{assert.deepEqual(Object.keys(query).sort(),['source','visitId']);state.calls.push('assignment');return {...state.assignment};},resolveCustomerVisit:async query=>{assert(!Object.hasOwn(query,'credential'));state.calls.push('customer');return {...state.resolved};}});
  return {state,gate};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
test('missing real adapters deny by default',async()=>{await rejects(createPreparedDesignAccessGate().authorize(credential,scope),'ADAPTER_NOT_CONFIGURED');});
test('exact authoritative appointment identity is accepted without returning credential',async()=>{const {gate}=fixture();const result=await gate.authorize(credential,scope);assert.deepEqual(result,{actor:{username:'synthetic-a',store:'synthetic-store'},scope});assert(Object.isFrozen(result.scope));assert(Object.isFrozen(result.actor));});
test('frontdesk uses its own exact source and visit binding',async()=>{const {state,gate}=fixture();state.assignment.source='frontdesk';state.resolved.assignmentSource='frontdesk';assert.equal((await gate.authorize(credential,{...scope,assignmentSource:'frontdesk'})).scope.assignmentSource,'frontdesk');});
test('client owner/store/username claims and phone/name substitutes are rejected',async()=>{for(const key of ['owner','store','username','phone','name']){const {gate}=fixture();await rejects(gate.authorize(credential,{...scope,[key]:'claimed'}),'INVALID_SCOPE');}});
test('expired inactive malformed and missing employee sessions deny',async()=>{for(const patch of [{active:false},{expiresAt:1000},{expiresAt:NaN},{username:''},{store:''}]){const {state,gate}=fixture();Object.assign(state.employee,patch);await rejects(gate.authorize(credential,scope),'AUTHENTICATION_REQUIRED');}});
test('same-store other stylist, moved store, reassignment and cancelled visit deny',async()=>{for(const patch of [{staffUsername:'other'},{store:'other'},{active:false},{visitId:'other'},{customerProfileId:'other'},{source:'frontdesk'}]){const {state,gate}=fixture();Object.assign(state.assignment,patch);await rejects(gate.authorize(credential,scope),'RELATIONSHIP_DENIED');}});
test('ambiguous/shared-phone customer mappings and mismatched visits deny',async()=>{for(const patch of [{unambiguous:false},{customerProfileId:'other'},{visitId:'other'},{store:'other'},{assignmentSource:'frontdesk'}]){const {state,gate}=fixture();Object.assign(state.resolved,patch);await rejects(gate.authorize(credential,scope),'CUSTOMER_VISIT_DENIED');}});
test('invalid scopes cannot become broad all-store reads',async()=>{for(const requested of [{...scope,customerProfileId:''},{...scope,visitId:null},{...scope,assignmentSource:'all'},{}]){const {gate}=fixture();await rejects(gate.authorize(credential,requested),'INVALID_SCOPE');}});
test('read rechecks relationship before returning delayed data',async()=>{const {state,gate}=fixture();await rejects(gate.withAuthorizedRead({credential,scope},async()=>{state.assignment.active=false;return {privateResult:'not returned'};}),'RELATIONSHIP_DENIED');assert.equal(state.calls.filter(x=>x==='auth').length,2);});
test('commit guard is revalidated each time, never a durable bearer grant',async()=>{const {state,gate}=fixture();const guard=await gate.createCommitGuard({credential,scope});await guard.recheck();state.employee.active=false;await rejects(guard.recheck(),'AUTHENTICATION_REQUIRED');});
test('changing actor despite matching reassignment never delivers original actor read',async()=>{const {state,gate}=fixture();await rejects(gate.withAuthorizedRead({credential,scope},async()=>{state.employee.username='synthetic-b';state.assignment.staffUsername='synthetic-b';return {};}),'ACTOR_CHANGED');});
test('lookup errors fail closed and do not echo token or service details',async()=>{const gate=createPreparedDesignAccessGate({authenticate:async()=>{throw Error('secret detail');},resolveAssignment:async()=>{},resolveCustomerVisit:async()=>{}});await assert.rejects(gate.authorize(credential,scope),error=>error.code==='AUTHENTICATION_REQUIRED'&&!error.message.includes('secret'));});

test('caller scope mutations cannot redirect delayed read or commit rechecks',async()=>{
 const {state,gate}=fixture();const requested={...scope};
 const guard=await gate.createCommitGuard({credential,scope:requested});requested.customerProfileId='other';
 assert.equal((await guard.recheck()).scope.customerProfileId,scope.customerProfileId);
 const readScope={...scope};const result=await gate.withAuthorizedRead({credential,scope:readScope},async()=>{readScope.visitId='other';return 'original';});assert.equal(result,'original');
});

test('a session expiring during lookup cannot produce a grant',async()=>{
 let time=1000;const gate=createPreparedDesignAccessGate({now:()=>time,authenticate:async()=>({username:'synthetic-a',store:'synthetic-store',active:true,expiresAt:1500}),resolveAssignment:async()=>({source:scope.assignmentSource,visitId:scope.visitId,customerProfileId:scope.customerProfileId,staffUsername:'synthetic-a',store:'synthetic-store',active:true}),resolveCustomerVisit:async()=>{time=1600;return {...scope,store:'synthetic-store',unambiguous:true};}});
 await rejects(gate.authorize(credential,scope),'AUTHENTICATION_REQUIRED');
});
