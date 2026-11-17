/** Pure synthetic tests. No SQL, sockets, credentials, model or live authority. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequestLocalDerivedSnapshot} from '../packages/design-production-adapter/request-local-derived-snapshot.mjs';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const original=()=>freeze({scope:{id:'synthetic'},revision:1,source:{text:'Synthetic exact source'},values:[1,2]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const record=original(),state={validations:0,builds:0,deny:false};
 const memo=createRequestLocalDerivedSnapshot({validateRecord(value,scope){state.validations++;if(state.deny||scope.id!==value.scope.id)throw Error('SYNTHETIC_REJECTED');return value;},createSnapshot(value){state.builds++;return freeze({scope:value.scope,revision:value.revision,source:value.source,values:value.values});}});
 return {memo,state,record};
}
test('default/no context computes each time; a scope reuses only successful validator identity',async()=>{
 const {memo,state,record}=fixture();memo.validate(record,record.scope).snapshot();memo.validate(record,record.scope).snapshot();assert.equal(state.builds,2);
 await memo.run(()=>{const first=memo.validate(record,record.scope).snapshot(),next=memo.validate(record,record.scope).snapshot();assert.strictEqual(first,next);assert.deepEqual(next.source,record.source);assert(Object.isFrozen(next.source));assert.equal(state.builds,3);});assert.equal(state.validations,4);
});
test('content-equal but distinct validated identities never share derived results',async()=>{
 const {memo,state,record}=fixture();await memo.run(()=>{const a=memo.validate(record,record.scope).snapshot(),b=memo.validate(original(),record.scope).snapshot();assert.notStrictEqual(a,b);assert.deepEqual(a,b);assert.equal(state.builds,2);});
});
test('new source, revision and scope cannot become an old result; validation always runs',async()=>{
 const {memo,state,record}=fixture();await memo.run(()=>{memo.validate(record,record.scope).snapshot();for(const changed of [freeze({...record,revision:2}),freeze({...record,source:{text:'Synthetic changed source'}}),freeze({...record,scope:{id:'other'}})]){const result=memo.validate(changed,changed.scope).snapshot();assert.deepEqual(result,changed);}assert.equal(state.builds,4);assert.throws(()=>memo.validate(record,{id:'other'}));state.deny=true;assert.throws(()=>memo.validate(record,record.scope));assert.equal(state.validations,6);assert.equal(state.builds,4);});
});
test('a previously cached pure result never turns a later failed validator into success',async()=>{
 const {memo,state,record}=fixture();await memo.run(()=>{memo.validate(record,record.scope).snapshot();state.deny=true;assert.throws(()=>memo.validate(record,record.scope));assert.equal(state.validations,2);assert.equal(state.builds,1);});
});
test('no cross-request reuse; nested and concurrent contexts are independent',async()=>{
 const {memo,state,record}=fixture();let first;await memo.run(()=>{first=memo.validate(record,record.scope).snapshot();});await memo.run(()=>assert.notStrictEqual(first,memo.validate(record,record.scope).snapshot()));
 await memo.run(async()=>{const outer=memo.validate(record,record.scope).snapshot();await memo.run(()=>assert.notStrictEqual(outer,memo.validate(record,record.scope).snapshot()));assert.strictEqual(outer,memo.validate(record,record.scope).snapshot());});
 const a=deferred(),b=deferred();await Promise.all([memo.run(async()=>{const value=memo.validate(record,record.scope).snapshot();a.resolve();await b.promise;assert.strictEqual(value,memo.validate(record,record.scope).snapshot());}),memo.run(async()=>{await a.promise;memo.validate(record,record.scope).snapshot();b.resolve();})]);assert.equal(state.builds,6);
});
test('success/error finally invalidates saved handles and inherited late async context',async()=>{
 for(const fail of [false,true]){const {memo,state,record}=fixture(),gate=deferred();let saved,late;
  const running=memo.run(()=>{saved=memo.validate(record,record.scope);saved.snapshot();late=gate.promise.then(()=>{saved.snapshot();memo.validate(record,record.scope).snapshot();});if(fail)throw Error('SYNTHETIC_FAILURE');});
  if(fail)await assert.rejects(running);else await running;gate.resolve();await late;assert.equal(state.builds,3);await memo.run(()=>{saved.snapshot();saved.snapshot();});assert.equal(state.builds,5);
 }
});
test('64 entry cap recomputes overflow without evicting valid entries or rejecting inputs',async()=>{
 const {memo,state,record}=fixture(),rows=Array.from({length:65},(_,revision)=>freeze({...record,revision}));await memo.run(()=>{for(const row of rows)memo.validate(row,row.scope).snapshot();assert.equal(state.builds,65);memo.validate(rows[64],rows[64].scope).snapshot();assert.equal(state.builds,66);memo.validate(rows[0],rows[0].scope).snapshot();assert.equal(state.builds,66);});
});
test('16 MiB combined key/value cap falls back without rejecting valid immutable structure',async()=>{
 let builds=0;const record=freeze({items:Array.from({length:129},()=> 'x'.repeat(65536))});const memo=createRequestLocalDerivedSnapshot({validateRecord:()=>record,createSnapshot:r=>{builds++;return r;}});await memo.run(()=>{const handle=memo.validate(record,{});assert.strictEqual(handle.snapshot(),record);assert.strictEqual(handle.snapshot(),record);});assert.equal(builds,2);
});
test('record must be deeply frozen JSON, not mutable, Promise, getter, proxy or fake brand',()=>{
 for(const kind of ['mutable','child','promise','getter','proxy','brand']){let reads=0,builds=0;const getter=()=>{reads++;throw Error('must not execute');};let record;
  if(kind==='mutable')record={};if(kind==='child')record=Object.freeze({child:{}});if(kind==='promise')record=Promise.resolve({});if(kind==='getter')record=Object.freeze(Object.defineProperty({},'field',{enumerable:true,get:getter}));if(kind==='proxy')record=new Proxy(Object.freeze({}),{ownKeys:getter});if(kind==='brand')record=Object.freeze({isValidated:true,toJSON:getter});
  const memo=createRequestLocalDerivedSnapshot({validateRecord:()=>record,createSnapshot:()=>{builds++;return freeze({});}});assert.throws(()=>memo.validate(record,{}),/DERIVED_SNAPSHOT_INVALID/);assert.equal(reads,0);assert.equal(builds,0);
 }
});
test('derived builder failures, mutable/accessor outputs and promises never populate the cache',async()=>{
 for(const kind of ['throws','mutable','getter','promise']){let builds=0,reads=0;const record=original();const memo=createRequestLocalDerivedSnapshot({validateRecord:()=>record,createSnapshot(){builds++;if(kind==='throws')throw Error('SYNTHETIC');if(kind==='mutable')return {};if(kind==='promise')return Promise.resolve({});return Object.freeze(Object.defineProperty({},'field',{enumerable:true,get(){reads++;throw Error('must not execute');}}));}});await memo.run(()=>{const handle=memo.validate(record,record.scope);for(let i=0;i<2;i++)assert.throws(()=>handle.snapshot());});assert.equal(builds,2);assert.equal(reads,0);}
});
test('independent factories cannot plant a result in another private namespace',async()=>{
 const {memo,state,record}=fixture();const other=createRequestLocalDerivedSnapshot({validateRecord:()=>record,createSnapshot:()=>freeze({other:true})});await memo.run(async()=>{await other.run(()=>other.validate(record,record.scope).snapshot());assert.deepEqual(memo.validate(record,record.scope).snapshot().source,record.source);});assert.equal(state.builds,1);
});
