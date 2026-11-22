/** Server-only current App session verifier. It grants no customer/visit access,
 * issues no session/receipt and never copies the Supabase service key to a host. */
import {createHash,randomUUID} from 'node:crypto';
const URL_FIXED='https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/design-employee-authority';
const fail=()=>{throw Error('DESIGN_LIVE_EMPLOYEE_DENIED');};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const stable=v=>JSON.stringify([v.staffId,v.staffCreatedAt,v.actor.username,v.actor.store,v.sessionBinding,v.sourceRevision]);
const freeze=v=>{for(const x of Object.values(v))if(x&&typeof x==='object')freeze(x);return Object.freeze(v);};
export function createLiveEmployeeSessionVerifier({enabled=false,fetchImplementation,clock=()=>Date.now()}={}){
 async function verify(credential){
  if(enabled!==true||typeof fetchImplementation!=='function'||typeof credential!=='string'||credential.length<32||credential.length>200||/[\s\u0000-\u001f\u007f]/.test(credential))fail();
  const nonce=randomUUID(),before=clock(),timeout=AbortSignal.timeout(3000);
  try{
   if(!Number.isSafeInteger(before))fail();
   const response=await fetchImplementation(URL_FIXED,{method:'POST',headers:{'content-type':'application/json','x-employee-session':credential},body:JSON.stringify({nonce}),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:timeout});
   if(!response?.ok||response.status!==200||response.url!==URL_FIXED||response.redirected||!response.headers.get('content-type')?.startsWith('application/json')||!/\bprivate\b/i.test(response.headers.get('cache-control')??'')||!/\bno-store\b/i.test(response.headers.get('cache-control')??'')||Number(response.headers.get('content-length'))>4096)fail();
   let size=0;const chunks=[];for await(const p of response.body??[]){size+=p.length;if(size>4096||timeout.aborted)fail();chunks.push(p);}
   const bytes=Buffer.concat(chunks),now=clock();let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
   if(!exact(body,['ok','identity'])||body.ok!==true||!Number.isSafeInteger(now)||now<before||now-before>3000)fail();
   const v=body.identity;
   if(!exact(v,['schemaVersion','nonce','staffId','staffCreatedAt','actor','sessionBinding','sourceRevision','checkedAt','sessionExpiresAt','validUntil'])||v.schemaVersion!=='design-live-employee-v1'||v.nonce!==nonce||typeof v.staffId!=='string'||!/^\d{1,10}$/.test(v.staffId)||Number(v.staffId)<1||typeof v.staffCreatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v.staffCreatedAt)||!Number.isFinite(Date.parse(v.staffCreatedAt))||!exact(v.actor,['username','store'])||!['自由手艺人','向里造型'].includes(v.actor.store)||typeof v.actor.username!=='string'||!v.actor.username||v.actor.username.length>80||v.actor.username!==v.actor.username.trim()||/[\u0000-\u001f\u007f]/.test(v.actor.username)||v.sessionBinding!==createHash('sha256').update('design-live-employee-v1:'+credential).digest('hex')||typeof v.sourceRevision!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceRevision)||![v.checkedAt,v.sessionExpiresAt,v.validUntil].every(Number.isSafeInteger)||v.checkedAt<before-2000||v.checkedAt>now+250||now-v.checkedAt>2000||v.validUntil<=now||v.validUntil>Math.min(v.sessionExpiresAt,v.checkedAt+5000))fail();
   return freeze(v);
  }catch{fail();}
 }
 return Object.freeze({verify,async recheck(credential,expected){const current=await verify(credential);try{if(stable(current)!==stable(expected))fail();}catch{fail();}return current;}});
}
