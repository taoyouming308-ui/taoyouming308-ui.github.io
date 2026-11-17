import test from 'node:test';
import assert from 'node:assert/strict';
import {IMMUTABLE_AUTHORITY_SCHEMA,ImmutableDesignAuthorityError,validateImmutableDesignAuthority as validate} from '../packages/design-production-adapter/immutable-authority.mjs';

globalThis.fetch=()=>{throw Error('External I/O forbidden in immutable authority contract tests');};
const fixture=()=>({schemaVersion:IMMUTABLE_AUTHORITY_SCHEMA,subjectId:'synthetic-subject-1',employmentId:'synthetic-employment-1',membershipId:'synthetic-membership-1',securityEpoch:1,membershipRevision:1,storeId:'synthetic-store-1',actor:{username:'synthetic-alias',store:'Synthetic Store'},scope:{customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},bindingRevision:'synthetic-binding-1'});
const rejected=value=>assert.throws(()=>validate(value),error=>error instanceof ImmutableDesignAuthorityError&&error.code==='IMMUTABLE_AUTHORITY_INVALID'&&error.message==='IMMUTABLE_AUTHORITY_INVALID');
function deepFrozen(value){if(value&&typeof value==='object'){assert(Object.isFrozen(value));Object.values(value).forEach(deepFrozen);}}

test('valid authority is copied and deeply frozen without changing its values or bytes',()=>{
  const input=fixture(),before=JSON.stringify(input),value=validate(input);
  assert.deepEqual(value,input);assert.equal(JSON.stringify(value),before);assert.notStrictEqual(value,input);assert.notStrictEqual(value.actor,input.actor);assert.notStrictEqual(value.scope,input.scope);deepFrozen(value);
  input.scope.customerProfileId='12';input.actor.username='later-alias';assert.equal(value.scope.customerProfileId,'11');assert.equal(value.actor.username,'synthetic-alias');assert.throws(()=>{value.subjectId='changed';});
});
test('frontdesk scope uses the existing exact scope contract',()=>{
  const value=fixture();value.scope={customerProfileId:'11',visitId:'frontdesk:11111111-2222-7333-8444-555555555555',assignmentSource:'frontdesk'};assert.deepEqual(validate(value).scope,value.scope);
  for(const change of [{visitId:'booking:101'},{assignmentSource:'appointment'},{customerProfileId:'0'},{customerProfileId:'9007199254740992'},{visitId:'frontdesk:not-a-uuid'}])rejected({...value,scope:{...value.scope,...change}});
});
test('exact authority fields reject missing IDs, legacy identity and self-claimed permissions',()=>{
  for(const key of Object.keys(fixture())){const value=fixture();delete value[key];rejected(value);}
  for(const extra of ['approved','active','role','permissions','verified','token','authorityKey','expiresAt'])rejected({...fixture(),[extra]:true});
  rejected({username:'synthetic-alias',store:'Synthetic Store'});
  for(const schemaVersion of ['design-authority-v1','design-immutable-authority-v2','',null])rejected({...fixture(),schemaVersion});
});
test('immutable IDs and binding revision remain explicit bounded strings',()=>{
  for(const field of ['subjectId','employmentId','membershipId','storeId','bindingRevision']){
    assert.equal(validate({...fixture(),[field]:'x'.repeat(160)})[field].length,160);
    for(const value of ['',null,1,true,' x','x ','x\n','x\u0000y','x\u007fy','x'.repeat(161)])rejected({...fixture(),[field]:value});
  }
});
test('epochs require positive safe integer values without coercion or negative zero',()=>{
  for(const field of ['securityEpoch','membershipRevision']){
    assert.equal(validate({...fixture(),[field]:Number.MAX_SAFE_INTEGER})[field],Number.MAX_SAFE_INTEGER);
    for(const value of [0,-0,-1,0.5,'1',null,true,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])rejected({...fixture(),[field]:value});
  }
});
test('actor display fields have exact keys and limits, never substitute for principal IDs',()=>{
  assert.equal(validate({...fixture(),actor:{username:'u'.repeat(80),store:'s'.repeat(100)}}).actor.username.length,80);
  for(const actor of [{username:'x',store:'s',subjectId:'fake'},{username:'x'},{username:'u'.repeat(81),store:'s'},{username:'x',store:'s'.repeat(101)},{username:' x',store:'s'},{username:'x',store:'s\u007f'}])rejected({...fixture(),actor});
  const first=fixture(),renamed={...first,actor:{username:'renamed',store:'New label'}};
  assert.equal(validate(renamed).subjectId,first.subjectId);assert.equal(validate(renamed).membershipId,first.membershipId);
  const missing={...renamed};delete missing.subjectId;rejected(missing);
});
test('scope rejects extra identity/permission fields and cross-kind locator tricks',()=>{
  for(const change of [{customerProfileId:'0011'},{customerProfileId:11},{visitId:'booking:0'},{assignmentSource:'client'},{actor:'fake'},{storeId:'fake'},{customerId:'11'}])rejected({...fixture(),scope:{...fixture().scope,...change}});
});
test('alternating getters at every object level are rejected without execution',()=>{
  for(const [target,key] of [['root','subjectId'],['root','actor'],['actor','username'],['scope','visitId']]){
    const input=fixture();let reads=0;const object=target==='root'?input:input[target],good=object[key];Object.defineProperty(object,key,{enumerable:true,get(){reads++;return reads%2?good:'forged';}});rejected(input);assert.equal(reads,0);
  }
});
test('ordinary and revoked proxies cannot exercise traps or carry authority',()=>{
  for(const target of ['root','actor','scope']){
    const input=fixture();let traps=0;const proxy=new Proxy(target==='root'?input:input[target],{get(){traps++;throw Error('secret');},getPrototypeOf(){traps++;throw Error('secret');},ownKeys(){traps++;throw Error('secret');}});rejected(target==='root'?proxy:{...input,[target]:proxy});assert.equal(traps,0);
  }
  const {proxy,revoke}=Proxy.revocable(fixture(),{});revoke();rejected(proxy);
});
test('inherited getters, iterators and toJSON never execute',()=>{
  for(const target of ['root','actor','scope']){
    const input=fixture();let reads=0;const object=target==='root'?input:input[target];Object.setPrototypeOf(object,{get subjectId(){reads++;return 'fake';},toJSON(){reads++;return fixture();},[Symbol.iterator](){reads++;return [][Symbol.iterator]();}});rejected(input);assert.equal(reads,0);
  }
});
test('symbols, accessors, nonenumerable and dangerous own keys reject before use',()=>{
  for(const kind of ['symbol','nonenumerable','toJSON','constructor','prototype','__proto__']){
    const input=fixture();let calls=0;
    if(kind==='symbol')input[Symbol('secret')]='hidden';
    else if(kind==='toJSON')input.toJSON=()=>{calls++;return fixture();};
    else Object.defineProperty(input,kind,{value:'hidden',enumerable:kind!=='nonenumerable'});
    rejected(input);assert.equal(calls,0);
  }
});
test('non-JSON values, array impostors and cyclic nesting fail with fixed public error',()=>{
  for(const input of [undefined,null,[],new Date(),new Map(),Object.create(null),new(class {})(),()=>{},'authority',42,1n])rejected(input);
  const cycle=fixture();cycle.actor=cycle;rejected(cycle);
  for(const actor of [[],Object.create(null),new Date(),{username:'x',store:()=>{throw Error('secret');}}])rejected({...fixture(),actor});
});
test('each call independently validates structure and does not attest live authority',()=>{
  const input=fixture(),first=validate(input),second=validate(first);assert.notStrictEqual(first,second);assert.deepEqual(first,second);
  // Deliberately arbitrary, well-shaped IDs are structurally accepted. Only the
  // separate authoritative resolver can decide whether such identities exist.
  assert.equal(validate({...input,subjectId:'unverified-structural-id'}).subjectId,'unverified-structural-id');
  const forged={...input,validated:true};rejected(forged);
});
test('oversized shape and deeply nested wrong data reject before reaching any payload hook',()=>{
  const wide=fixture();for(let i=0;i<100;i++)wide['extra'+i]='synthetic';rejected(wide);
  const deep=fixture();let node=deep;for(let i=0;i<10;i++){node.actor={};node=node.actor;}
  let reads=0;Object.defineProperty(node,'secret',{enumerable:true,get(){reads++;throw Error('secret');}});rejected(deep);assert.equal(reads,0);
});
