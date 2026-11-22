/** Pure authority-envelope structure only. No authentication, grant or I/O. */
import {types as nodeTypes} from 'node:util';
import {Buffer} from 'node:buffer';
import {validateProductionDesignScope} from './employee-adapter.mjs';

export const IMMUTABLE_AUTHORITY_SCHEMA='design-immutable-authority-v1';
export class ImmutableDesignAuthorityError extends Error {
  constructor(){super('IMMUTABLE_AUTHORITY_INVALID');this.name='ImmutableDesignAuthorityError';this.code='IMMUTABLE_AUTHORITY_INVALID';}
}
const fail=()=>{throw new ImmutableDesignAuthorityError();};
const clean=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const keys=(value,expected)=>{
  if(value===null||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join('|')!==[...expected].sort().join('|'))fail();
};

// The envelope is small and object-only. Copy own data descriptors before any
// field is read, so a getter/Proxy cannot alternate data between checks/output.
function snapshot(input){
  let nodes=0,bytes=0;
  const charge=value=>{bytes+=Buffer.byteLength(value);if(bytes>8192)fail();};
  function copy(value,depth){
    if(++nodes>64||depth>4||nodeTypes.isProxy(value))fail();
    if(typeof value==='string'){if(value.length>160)fail();charge(JSON.stringify(value));return value;}
    if(typeof value==='number'){if(!Number.isFinite(value)||Object.is(value,-0))fail();charge(JSON.stringify(value));return value;}
    if(value===null||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)fail();
    const names=Reflect.ownKeys(value),result={};if(names.length>16)fail();charge('{}'+','.repeat(Math.max(0,names.length-1)));
    for(const name of names){
      if(typeof name!=='string'||name.length>160||['__proto__','prototype','constructor'].includes(name))fail();
      const descriptor=Object.getOwnPropertyDescriptor(value,name);
      if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail();
      charge(JSON.stringify(name)+':');result[name]=copy(descriptor.value,depth+1);
    }
    return result;
  }
  return copy(input,0);
}

/**
 * Returns an independent deeply frozen structural copy, not a trusted identity
 * proof. The server must resolve this envelope from current authoritative rows
 * and recheck its full identity, epochs, scope and binding at each required gate.
 * Display actor names never fill missing immutable IDs; no legacy fallback or
 * implicit conversion is provided. Existing archive/actor bytes are untouched.
 */
export function validateImmutableDesignAuthority(input){
  const value=snapshot(input);
  keys(value,['schemaVersion','subjectId','employmentId','membershipId','securityEpoch','membershipRevision','storeId','actor','scope','bindingRevision']);
  if(value.schemaVersion!==IMMUTABLE_AUTHORITY_SCHEMA)fail();
  for(const field of ['subjectId','employmentId','membershipId','storeId','bindingRevision'])if(!clean(value[field],160))fail();
  for(const field of ['securityEpoch','membershipRevision'])if(!Number.isSafeInteger(value[field])||value[field]<1)fail();
  keys(value.actor,['username','store']);
  if(!clean(value.actor.username,80)||!clean(value.actor.store,100))fail();
  try{value.scope=validateProductionDesignScope(value.scope);}catch{fail();}
  return freeze(value);
}
