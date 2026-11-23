/** Server-only fresh binding evidence, not photo/processing/model permission. */
import {randomUUID,createHash} from 'node:crypto';
import {SERVICE_BINDING_URL,validateServiceBindingInput} from '../shared/design-service-binding-contract.mjs';
const fail=()=>{throw Error('DESIGN_LIVE_SERVICE_BINDING_DENIED');};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const freeze=v=>{for(const x of Object.values(v))if(x&&typeof x==='object')freeze(x);return Object.freeze(v);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const projection=v=>[v.visitKey,v.profileId,v.staffId,v.staffCreatedAt,v.actor.username,v.actor.store,v.store,v.date,v.revision,v.sourceSha,v.profileSha,v.staffSha,v.sessionBinding];
export function createLiveServiceBindingVerifier({enabled=false,fetchImplementation,clock=()=>Date.now()}={}){
 async function verify(credential,scope){
  if(enabled!==true||typeof fetchImplementation!=='function'||typeof credential!=='string'||credential.length<32||credential.length>200||/[\s\u0000-\u001f\u007f]/.test(credential))fail();
  try{
   if(!exact(scope,['customerProfileId','visitId','assignmentSource'])||!['appointment','frontdesk'].includes(scope.assignmentSource)||typeof scope.visitId!=='string'||!scope.visitId.startsWith(scope.assignmentSource==='appointment'?'booking:':'frontdesk:'))fail();
   const fixed=scope,nonce=randomUUID(),start=clock();
   const input=validateServiceBindingInput({action:'resolve',visitKey:fixed.visitId,profileId:fixed.customerProfileId,nonce});
   const deadline=AbortSignal.timeout(5000);
   const response=await fetchImplementation(SERVICE_BINDING_URL,{method:'POST',headers:{'content-type':'application/json','x-employee-session':credential},body:JSON.stringify(input),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:deadline});
   if(response.status!==200||response.url!==SERVICE_BINDING_URL||response.redirected||!response.headers.get('content-type')?.startsWith('application/json')||!/\bprivate\b/i.test(response.headers.get('cache-control')??'')||!/\bno-store\b/i.test(response.headers.get('cache-control')??'')||Number(response.headers.get('content-length'))>16000)fail();
   let n=0;const chunks=[];for await(const p of response.body??[]){n+=p.length;if(n>16000||deadline.aborted)fail();chunks.push(p);}
   const bytes=Buffer.concat(chunks);let doc;try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
   const now=clock();if(!exact(doc,['ok','result'])||doc.ok!==true||!Number.isSafeInteger(start)||!Number.isSafeInteger(now)||now<start||now-start>5000)fail();
   const v=doc.result;
   if(!exact(v,['schemaVersion','nonce','visitKey','profileId','staffId','staffCreatedAt','actor','store','date','revision','sourceSha','profileSha','staffSha','sessionBinding','checkedAt','validUntil'])||v.schemaVersion!=='design-live-service-binding-v1'||v.nonce!==nonce||v.visitKey!==input.visitKey||v.profileId!==input.profileId||typeof v.staffId!=='string'||!/^[1-9][0-9]{0,9}$/.test(v.staffId)||typeof v.staffCreatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v.staffCreatedAt)||!Number.isFinite(Date.parse(v.staffCreatedAt))||!exact(v.actor,['username','store'])||typeof v.actor.username!=='string'||v.actor.username.length<1||v.actor.username.length>80||v.actor.username!==v.actor.username.trim()||/[\u0000-\u001f\u007f]/.test(v.actor.username)||v.actor.store!==v.store||!['自由手艺人','向里造型'].includes(v.store)||typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!Number.isSafeInteger(v.revision)||v.revision<1)fail();
   for(const k of ['sourceSha','profileSha','staffSha'])if(typeof v[k]!=='string'||!/^[a-f0-9]{64}$/.test(v[k]))fail();
   if(v.sessionBinding!==createHash('sha256').update('design-live-employee-v1:'+credential).digest('hex')||!Number.isSafeInteger(v.checkedAt)||!Number.isSafeInteger(v.validUntil)||v.checkedAt<start-1000||v.checkedAt>now+1000||v.validUntil<=now||v.validUntil<=v.checkedAt||v.validUntil-v.checkedAt>5000||deadline.aborted)fail();
   return freeze(v);
  }catch{fail();}
 }
 return Object.freeze({verify,async recheck(credential,scope,prior){const current=await verify(credential,scope);if(!prior||!same(projection(current),projection(prior)))fail();return current;}});
}
