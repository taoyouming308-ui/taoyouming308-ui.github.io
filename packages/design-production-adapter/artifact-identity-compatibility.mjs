/** Read-only sidecar compatibility. No issuer, database, credentials or activation defaults. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {Buffer} from 'node:buffer';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {validateFullWorkflowChain,FULL_WORKFLOW_CHAIN_MAX_BYTES} from './full-workflow-archive.mjs';
import {sniffPrivateImage,PRIVATE_MEDIA_MAX_BYTES} from './private-media.mjs';

export const ARTIFACT_ATTESTATION_SCHEMA='design-artifact-access-attestation-v1';
const CODES=new Set(['ARTIFACT_ACCESS_DISABLED','ARTIFACT_ACCESS_INVALID','ARTIFACT_ACCESS_DENIED','ARTIFACT_SOURCE_CHANGED','ARTIFACT_RESULT_INVALID','ARTIFACT_TRANSACTION_INVALID','ARTIFACT_ACCESS_UNAVAILABLE','ARTIFACT_WRITE_DISABLED','ARTIFACT_LIMIT']);
export class ArtifactIdentityError extends Error{constructor(code){super(CODES.has(code)?code:'ARTIFACT_ACCESS_UNAVAILABLE');this.name='ArtifactIdentityError';this.code=this.message;this.retryable=false;}}
const fail=code=>{throw new ArtifactIdentityError(code);};
const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>canon(a)===canon(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const plain=v=>v!==null&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('ARTIFACT_ACCESS_INVALID');};
const id=v=>{if(typeof v!=='string'||!v.length||v.length>160||v!==v.trim()||/[\u0000-\u001f\u007f]/.test(v)||['__proto__','prototype','constructor'].includes(v))fail('ARTIFACT_ACCESS_INVALID');return v;};
const integer=v=>{if(!Number.isSafeInteger(v)||v<1)fail('ARTIFACT_ACCESS_INVALID');return v;};
const own=(v,keys)=>{if(types.isProxy(v)||!plain(v))fail('ARTIFACT_ACCESS_INVALID');const names=Reflect.ownKeys(v);if(names.length!==keys.length||names.some(k=>!keys.includes(k)))fail('ARTIFACT_ACCESS_INVALID');const out={};for(const k of names){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('ARTIFACT_ACCESS_INVALID');out[k]=d.value;}return out;};
function copy(v,max=FULL_WORKFLOW_CHAIN_MAX_BYTES+65536){
 let nodes=0,bytes=0;const charge=n=>{bytes+=n;if(bytes>max)fail('ARTIFACT_LIMIT');};
 function walk(v,depth){
  if(++nodes>1500000||depth>90||types.isProxy(v))fail('ARTIFACT_LIMIT');
  if(v===null||['string','number','boolean'].includes(typeof v)){if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))fail('ARTIFACT_ACCESS_INVALID');charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))fail('ARTIFACT_ACCESS_INVALID');
  const keys=Reflect.ownKeys(v);if(Array.isArray(v)){
   if(keys.length!==v.length+1)fail('ARTIFACT_ACCESS_INVALID');charge(2+Math.max(0,v.length-1));const a=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('ARTIFACT_ACCESS_INVALID');a.push(walk(d.value,depth+1));}return a;
  }
  charge(2+Math.max(0,keys.length-1));const out={};for(const k of keys){if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k))fail('ARTIFACT_ACCESS_INVALID');const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('ARTIFACT_ACCESS_INVALID');charge(Buffer.byteLength(JSON.stringify(k))+1);out[k]=walk(d.value,depth+1);}return out;
 }return walk(v,0);
}
const scopeOf=v=>{try{return validateProductionDesignScope(copy(v,4096));}catch{fail('ARTIFACT_ACCESS_INVALID');}};
const actorOf=v=>{exact(v,['username','store']);id(v.username);id(v.store);return v;};
export function artifactReaderIdentity(authority){const a=validateImmutableDesignAuthority(authority);return freeze(Object.fromEntries(['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','bindingRevision'].map(k=>[k,a[k]])));}
const reference=r=>Object.fromEntries(['mediaId','stage','angle','mime','byteLength','width','height'].map(k=>[k,r[k]]));
function mediaRecord(r,scope){
 exact(r,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);exact(r.binding,['owner','store','scope']);id(r.binding.owner);id(r.binding.store);
 if(!equal(scopeOf(r.binding.scope),scope)||r.active!==true||r.mediaId!==r.requestId||typeof r.mediaId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.mediaId)||!['before','after','reference'].includes(r.stage)||!['front','back','left','right','detail'].includes(r.angle)||!['image/png','image/jpeg','image/webp'].includes(r.mime)||!Number.isSafeInteger(r.byteLength)||r.byteLength<1||r.byteLength>PRIVATE_MEDIA_MAX_BYTES||!/^[a-f0-9]{64}$/.test(r.sha256)||!['width','height'].every(k=>Number.isSafeInteger(r[k])&&r[k]>0&&r[k]<=16384)||r.width*r.height>40000000)fail('ARTIFACT_ACCESS_DENIED');
}
/** Descriptor only: never authority. Callers cannot submit this to a read route. */
export function describeIdentityArtifact(input){
 const item=copy(input);exact(item,['kind','id','version','scope','payload']);id(item.id);integer(item.version);const scope=scopeOf(item.scope);
 if(item.kind==='private_media'){mediaRecord(item.payload,scope);if(item.id!==item.payload.mediaId||item.version!==1)fail('ARTIFACT_ACCESS_INVALID');}
 else if(item.kind==='candidate'){const c=item.payload;if(!plain(c)||c.schemaVersion!=='design-model-candidate-v1'||c.id!==item.id||item.version!==1||!equal(c.scope,scope)||c.store!==actorOf(c.actor).store||Buffer.byteLength(canon(c))>262144)fail('ARTIFACT_ACCESS_INVALID');}
 else if(item.kind==='full_version'){if(item.id!==item.payload.requestId||item.version!==item.payload.version||!equal(item.payload.scope,scope))fail('ARTIFACT_ACCESS_INVALID');actorOf(item.payload.actor);}
 else fail('ARTIFACT_ACCESS_INVALID');
 return freeze({kind:item.kind,id:item.id,version:item.version,scope,sha256:hash('design-artifact-access-content-v1\0'+canon(item))});
}
function authors(item){
 if(item.kind==='private_media')return [{username:item.payload.binding.owner,store:item.payload.binding.store}];
 if(item.kind==='candidate')return [actorOf(item.payload.actor)];
 // This is a declaration about the original envelope author only. Nested source
 // labels and historic authors remain unchanged and unresolved, not inferred.
 return [actorOf(item.payload.actor)];
}
function attestation(raw,artifact,reader,item,now){
 const a=copy(raw,32768);exact(a,['schemaVersion','id','revision','issuerId','active','issuedAt','expiresAt','artifact','reader','authorship']);
 if(a.schemaVersion!==ARTIFACT_ATTESTATION_SCHEMA||a.active!==true||!equal(a.artifact,artifact)||!equal(a.reader,reader)||!Number.isSafeInteger(a.issuedAt)||!Number.isSafeInteger(a.expiresAt)||a.issuedAt>now||a.expiresAt<=now||a.expiresAt<=a.issuedAt)fail('ARTIFACT_ACCESS_DENIED');
 id(a.id);id(a.issuerId);integer(a.revision);exact(a.authorship,['status','legacyActor']);
 if(a.authorship.status!=='unresolved'||!equal(a.authorship.legacyActor,authors(item)[0]))fail('ARTIFACT_ACCESS_DENIED');return freeze(a);
}
const operations={media_read:{kind:'private_media',keys:['credential','scope','approval','mediaId']},media_references:{kind:'private_media',keys:['credential','scope','approval','mediaIds']},candidate_load:{kind:'candidate',keys:['credential','scope','candidateId']},history_load:{kind:'full_version',keys:['credential','scope']}};
function request(operation,input){
 const raw=own(input,operations[operation].keys),fixed=copy(raw,65536);fixed.scope=scopeOf(fixed.scope);
 if(typeof fixed.credential!=='string'||fixed.credential.length<32||fixed.credential.length>200||/[\s\u0000-\u001f\u007f]/.test(fixed.credential))fail('ARTIFACT_ACCESS_INVALID');
 const ids=operation==='media_read'?[fixed.mediaId]:operation==='media_references'?fixed.mediaIds:operation==='candidate_load'?[fixed.candidateId]:[];
 if(!Array.isArray(ids)||ids.length>30||operation!=='history_load'&&!ids.length||new Set(ids).size!==ids.length)fail('ARTIFACT_ACCESS_INVALID');ids.forEach(id);return {fixed:freeze(fixed),selection:freeze({operation,scope:fixed.scope,ids:[...ids]})};
}
function sourceSet(raw,selection){
 const items=copy(raw);if(!Array.isArray(items)||items.length<1||items.length>(selection.operation==='history_load'?100:30))fail('ARTIFACT_ACCESS_DENIED');
 const descriptors=items.map(item=>describeIdentityArtifact(item));
 if(descriptors.some(d=>d.kind!==operations[selection.operation].kind||!equal(d.scope,selection.scope))||new Set(descriptors.map(d=>canon([d.kind,d.id,d.version]))).size!==items.length)fail('ARTIFACT_ACCESS_DENIED');
 if(selection.operation==='history_load'){try{validateFullWorkflowChain(items.map(x=>x.payload),selection.scope);}catch{fail('ARTIFACT_ACCESS_DENIED');}}
 else if(!equal(descriptors.map(d=>d.id),selection.ids))fail('ARTIFACT_ACCESS_DENIED');
 return freeze({items,descriptors});
}
function checkedResult(operation,raw,sources){
 const payloads=sources.items.map(x=>x.payload);
 if(operation==='media_read'){
  const result=own(raw,['reference','bytes','cacheControl','maxAgeSeconds']);
  if(types.isProxy(result.bytes)||!(result.bytes instanceof Uint8Array)||result.bytes.byteLength<1||result.bytes.byteLength>PRIVATE_MEDIA_MAX_BYTES)fail('ARTIFACT_RESULT_INVALID');
  const bytes=Uint8Array.from(result.bytes),record=payloads[0];let mime;try{mime=sniffPrivateImage(bytes);}catch{fail('ARTIFACT_RESULT_INVALID');}
  if(bytes.length!==record.byteLength||hash(bytes)!==record.sha256||mime!==record.mime||!equal(copy(result.reference,4096),reference(record))||result.cacheControl!=='private, no-store'||result.maxAgeSeconds!==0)fail('ARTIFACT_RESULT_INVALID');
  return Object.freeze({reference:freeze(copy(result.reference,4096)),bytes,cacheControl:'private, no-store',maxAgeSeconds:0});
 }
 const result=copy(raw);
 if(operation==='media_references'){exact(result,['references']);if(!equal(result.references,payloads.map(reference)))fail('ARTIFACT_RESULT_INVALID');}
 else if(operation==='candidate_load'){exact(result,['candidate']);if(!equal(result.candidate,payloads[0]))fail('ARTIFACT_RESULT_INVALID');}
 else{exact(result,['currentVersion','currentDigest','versions']);const head=payloads.at(-1);if(!equal(result.versions,payloads)||result.currentVersion!==head.version||result.currentDigest!==head.sha256)fail('ARTIFACT_RESULT_INVALID');}
 return freeze(result);
}
/**
 * Trusted config only. repository.withReadTransaction must lock authority,
 * original artifacts and independently issued attestation rows through guards.
 * issuer.verify is independent issuer validation, NOT a supplied approved flag.
 * No method installs these wrappers into the legacy/full runtime automatically.
 */
export function createArtifactIdentityCompatibility({enabled=false,repository,issuer,readers}={}){
 function ready(operation){const reader=operation==='media_read'?readers?.media?.read:operation==='media_references'?readers?.media?.resolveReferences:operation==='candidate_load'?readers?.candidate?.load:readers?.history?.load;if(enabled!==true||typeof repository?.withReadTransaction!=='function'||typeof issuer?.verify!=='function'||typeof reader!=='function')fail('ARTIFACT_ACCESS_DISABLED');return reader;}
 async function inspect(fixed,selection,expected){
  let invoked=false,guardClaimed=false,guarded=false,returned;
  const value=await repository.withReadTransaction(async tx=>{
   if(invoked)fail('ARTIFACT_TRANSACTION_INVALID');invoked=true;
   if(!tx||['resolveAuthority','loadArtifacts','readAttestations','now','beforeCommit'].some(k=>typeof tx[k]!=='function'))fail('ARTIFACT_TRANSACTION_INVALID');
   async function check(prior){
    const authority=validateImmutableDesignAuthority(await tx.resolveAuthority({credential:fixed.credential,scope:fixed.scope}));if(!equal(authority.scope,fixed.scope)||prior&&!equal(prior.authority,authority))fail('ARTIFACT_ACCESS_DENIED');
    const reader=artifactReaderIdentity(authority),sources=sourceSet(await tx.loadArtifacts(selection),selection);
    if(prior&&!equal(prior.sources,sources))fail('ARTIFACT_SOURCE_CHANGED');
    const proofs=[];
    for(let i=0;i<sources.items.length;i++){
     const rows=copy(await tx.readAttestations({artifact:sources.descriptors[i],reader}),65536);if(!Array.isArray(rows)||rows.length!==1)fail('ARTIFACT_ACCESS_DENIED');
     const now=await tx.now();if(!Number.isSafeInteger(now)||now<0)fail('ARTIFACT_ACCESS_DENIED');
     const proof=attestation(rows[0],sources.descriptors[i],reader,sources.items[i],now);
     if(await issuer.verify(proof,{authority,artifact:sources.descriptors[i],reader,transaction:tx})!==true)fail('ARTIFACT_ACCESS_DENIED');proofs.push(proof);
    }
    if(prior&&!equal(proofs,prior.proofs))fail('ARTIFACT_ACCESS_DENIED');
    if(!equal(validateImmutableDesignAuthority(await tx.resolveAuthority({credential:fixed.credential,scope:fixed.scope})),authority))fail('ARTIFACT_ACCESS_DENIED');
    const now=await tx.now();if(!Number.isSafeInteger(now)||now<0||proofs.some(p=>p.expiresAt<=now||p.issuedAt>now))fail('ARTIFACT_ACCESS_DENIED');
    return freeze({authority,sources,proofs});
   }
   returned=await check(expected);await tx.beforeCommit(async()=>{if(guardClaimed)fail('ARTIFACT_TRANSACTION_INVALID');guardClaimed=true;await check(returned);guarded=true;});return returned;
  });
  if(!invoked||!guarded||value!==returned)fail('ARTIFACT_TRANSACTION_INVALID');return value;
 }
 async function call(operation,input){
  const reader=ready(operation);let result;
  try{const {fixed,selection}=request(operation,input),before=await inspect(fixed,selection);result=checkedResult(operation,await reader(fixed),before.sources);await inspect(fixed,selection,before);return result;}
  catch(error){if(result?.bytes instanceof Uint8Array)result.bytes.fill(0);if(error instanceof ArtifactIdentityError)throw new ArtifactIdentityError(error.code);fail('ARTIFACT_ACCESS_UNAVAILABLE');}
 }
 const noWrite=async()=>fail('ARTIFACT_WRITE_DISABLED');
 return Object.freeze({
  media:Object.freeze({read:input=>call('media_read',input),resolveReferences:input=>call('media_references',input),upload:noWrite}),
  candidate:Object.freeze({load:input=>call('candidate_load',input),publish:noWrite,extract:noWrite,vision:noWrite,compare:noWrite,synthesize:noWrite,accept:noWrite}),
  history:Object.freeze({load:input=>call('history_load',input),append:noWrite}),
 });
}
