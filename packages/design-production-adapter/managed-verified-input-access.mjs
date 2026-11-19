/** Server-only, read-only composition. No URL/body is returned to HTTP and no
 * issuance, model dispatch or key access exists. Ledger is the fixed independent
 * issuer-aware repository, never a client-supplied structural report validator.
 * Owned byte copies are wiped on failure; caller owns the successful byte copy.
 * Abort is cooperative: an ignored cancellation poisons this instance, preventing
 * accumulation of additional unresolved storage/ledger operations. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {managedImageCanonical,managedImageDigest,createManagedImageCandidate} from './managed-image-contracts.mjs';
import {validateManagedDerivedObjectReceipt,validateManagedImageVerificationReport} from './managed-image-verification.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
export class ManagedVerifiedInputError extends Error{constructor(){super('MANAGED_VERIFIED_INPUT_DENIED');this.code=this.message;this.outcome='not_sent';this.retryable=false;}}
const fail=()=>{throw new ManagedVerifiedInputError();},copy=v=>JSON.parse(managedImageCanonical(v)),same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const ns=Reflect.ownKeys(v);if(ns.length!==keys.length||ns.some(k=>!keys.includes(k)))fail();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;}
const typed=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(typed,k).get;
function byteCopy(v){if(types.isProxy(v)||!types.isUint8Array(v))fail();const b=get('buffer').call(v),n=get('byteLength').call(v);if(types.isSharedArrayBuffer(b)||n<1||n>524288)fail();return Buffer.from(new Uint8Array(b,get('byteOffset').call(v),n));}
function metadata(raw,q){const m=copy(exact(raw,['sourceRecord','response','objectReceipt','verificationReport']));m.objectReceipt=validateManagedDerivedObjectReceipt(m.objectReceipt,{sourceRecord:m.sourceRecord,response:m.response});m.verificationReport=validateManagedImageVerificationReport(m.verificationReport,{sourceRecord:m.sourceRecord,response:m.response,objectReceipt:m.objectReceipt});const c=createManagedImageCandidate({sourceRecord:m.sourceRecord,response:m.response,evidence:m.verificationReport.evidence});if(m.verificationReport.state!=='evidence_complete'||c.technicalStatus!=='evidence_complete'||c.sourceRecord.stage!=='before'||!['front','back','left','right'].includes(c.sourceRecord.angle)||!same(c.sourceRecord.owner.scope,q.scope))fail();
const binding={taskId:q.taskId,candidateDigest:managedImageDigest(c),objectReceiptDigest:managedImageDigest(m.objectReceipt),verificationReportDigest:managedImageDigest(m.verificationReport),authority:c.sourceRecord.owner,sourceRecordDigest:managedImageDigest(c.sourceRecord),responseDigest:managedImageDigest(c.response),evidenceDigest:managedImageDigest(c.evidence),sourceObject:c.sourceRecord.object,derivativeObject:m.objectReceipt.object,sourceSha256:c.sourceRecord.source.sha256,derivativeSha256:m.objectReceipt.derivative.sha256,mime:m.objectReceipt.derivative.mime,byteLength:m.objectReceipt.derivative.byteLength,maxEdge:c.budget.maxEdge,stage:'before',angle:c.sourceRecord.angle};return {m:freeze(m),binding:freeze(binding)};}
export function createManagedVerifiedInputAccess({enabled=false,ledger,storage,timeoutMs=5000}={}){
let busy=false,poisoned=false;
async function run(value,verify){let timer,bytes;const controller=new AbortController();try{
 if(enabled!==true||busy||poisoned||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||typeof ledger?.readVerifiedInput!=='function'||typeof storage?.read!=='function')fail();
 const q=copy(exact(value,verify?['credential','scope','taskId','binding']:['credential','scope','taskId']));if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>4096||typeof q.taskId!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(q.taskId))fail();q.scope=validateProductionDesignScope(q.scope);freeze(q);busy=true;
 const args=freeze({credential:q.credential,scope:q.scope,taskId:q.taskId});
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{poisoned=true;controller.abort();reject(new ManagedVerifiedInputError());},timeoutMs);});
 const step=fn=>Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)fail();return fn();}),deadline]);
 const first=metadata(await step(()=>ledger.readVerifiedInput(args)),q);
 if(verify){if(!same(first.binding,q.binding))fail();return true;}
 // Copy immediately on resolution, including late resolution. Never expose the
 // storage-owned buffer, never mutate it. A late owned copy is wiped immediately.
 const pending=Promise.resolve().then(()=>{if(controller.signal.aborted)fail();return storage.read({object:first.m.objectReceipt.object,derivative:first.m.objectReceipt.derivative,private:true,signal:controller.signal});}).then(raw=>{const owned=byteCopy(raw);if(controller.signal.aborted){owned.fill(0);fail();}bytes=owned;return owned;});
 await step(()=>pending);if(bytes.length!==first.binding.byteLength||createHash('sha256').update(bytes).digest('hex')!==first.binding.derivativeSha256)fail();
 const last=metadata(await step(()=>ledger.readVerifiedInput(args)),q);if(!same(first.m,last.m))fail();
 const result=Object.freeze({...last.m,bytes});bytes=null;return result;
 }catch{fail();}finally{clearTimeout(timer);bytes?.fill(0);controller.abort();if(timer!==undefined)busy=false;}}
return Object.freeze({readVerifiedInput:value=>run(value,false),verifyCurrentInput:value=>run(value,true)});
}
