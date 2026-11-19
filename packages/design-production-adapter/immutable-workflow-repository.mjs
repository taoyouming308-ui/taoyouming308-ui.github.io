/** Native workflow adapter for fixed PG capabilities. No raw-SQL/legacy-write fallback. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {createWorkflowAuthorityCapabilities} from './workflow-authority-capabilities.mjs';
import {artifactCopy as copyJSON} from './postgres-artifact-access-repository.mjs';
import {policyCanonical,policyDigest,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {createDesignSession} from '../analysis-engine/design-pilot.mjs';
import {createPreparedWorkflowRecord,validatePreparedWorkflowRecord,replayPreparedWorkflowIntentAgainstValidated,applyPreparedWorkflowIntent} from './prepared-workflow-service.mjs';
import {validateFullWorkflowChain} from './full-workflow-archive.mjs';
const SHA=/^[a-f0-9]{64}$/;
const TYPES=new Set(['record_source','record_note','advance','create_group','record_technique','record_context','record_review','confirm_entry','archive','reopen']);
const CODES=new Set(['IMMUTABLE_WORKFLOW_DISABLED','IMMUTABLE_WORKFLOW_INVALID','IMMUTABLE_WORKFLOW_DENIED','IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED','IMMUTABLE_WORKFLOW_CORRUPT','IMMUTABLE_WORKFLOW_CHANGED','IMMUTABLE_WORKFLOW_TRANSACTION','IMMUTABLE_WORKFLOW_UNCERTAIN']);
export class ImmutableWorkflowError extends Error{constructor(code){super(CODES.has(code)?code:'IMMUTABLE_WORKFLOW_DENIED');this.name='ImmutableWorkflowError';this.code=this.message;this.retryable=false;this.outcome=this.code==='IMMUTABLE_WORKFLOW_UNCERTAIN'?'uncertain':'withheld';}}
const fail=code=>{throw new ImmutableWorkflowError(code);};
const exact=(v,keys)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('IMMUTABLE_WORKFLOW_INVALID');};
const equal=policyEqual,hash=policyDigest,freeze=policyFreeze;
const tuple=a=>{const v=validateImmutableDesignAuthority(a);return v;};
const grant=a=>freeze({actor:a.actor,scope:a.scope});
export function assertImmutableWorkflowIntent(intent){const v=copyJSON(intent,16384);if(!TYPES.has(v?.type))fail('IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED');return v;}
function receipt(row,scope,revision){
 exact(row,['request_key','receipt','record_sha256']);const r=row.receipt;exact(r,['fingerprint','scope','actor','appliedRevision','request']);exact(r.actor,['username','store']);exact(r.request,['requestId','expectedRevision','intent']);
 if(!equal(r.scope,scope)||r.appliedRevision!==revision||r.request.expectedRevision!==revision-1||!SHA.test(row.record_sha256)||row.request_key!==hash([r.actor,r.request.requestId])||r.fingerprint!==hash({scope,...r.request}))fail('IMMUTABLE_WORKFLOW_CORRUPT');assertImmutableWorkflowIntent(r.request.intent);return r;
}
/** Full native replay, not a trusted-mark/SQL-authority cache. */
export function validateAuthorizedWorkflowBundle(input,expected){
 const b=copyJSON(input),a=tuple(expected);exact(b,['schemaVersion','authority','manifest','sourceFingerprint','workflowRows','workflowReceipts','legacyVersions','legacyPhotos','fullRows','fullReceipts','mediaRows','candidateRows','operationAuthors']);
 if(b.schemaVersion!=='design-authorized-workflow-bundle-v1'||!equal(tuple(b.authority),a)||!SHA.test(b.sourceFingerprint))fail('IMMUTABLE_WORKFLOW_CORRUPT');
 for(const k of ['workflowRows','workflowReceipts','legacyVersions','legacyPhotos','fullRows','fullReceipts','mediaRows','candidateRows','operationAuthors'])if(!Array.isArray(b[k]))fail('IMMUTABLE_WORKFLOW_CORRUPT');
 if(b.workflowRows.length>1001||b.legacyVersions.length>1000||b.fullRows.length>100||b.workflowReceipts.length!==Math.max(0,b.workflowRows.length-1)||b.fullReceipts.length!==b.fullRows.length)fail('IMMUTABLE_WORKFLOW_CORRUPT');
 if(b.mediaRows.length||b.candidateRows.length||b.legacyPhotos.length)fail('IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED');
 let base=-1;
 if(b.manifest!==null){const m=b.manifest;exact(m,['id','revision','reader','baseWorkflowRevision','baseWorkflowSha256','sourceFingerprint','expiresAt']);if(typeof m.id!=='string'||!m.id||!Number.isSafeInteger(m.revision)||m.revision<1||!equal(tuple(m.reader),a)||!Number.isSafeInteger(m.baseWorkflowRevision)||m.baseWorkflowRevision< -1||!SHA.test(m.sourceFingerprint)||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=Date.now())fail('IMMUTABLE_WORKFLOW_DENIED');base=m.baseWorkflowRevision;if(base>=0?b.workflowRows[base]?.sha256!==m.baseWorkflowSha256:m.baseWorkflowSha256!==null)fail('IMMUTABLE_WORKFLOW_CORRUPT');}
 else if(b.legacyVersions.length||b.fullRows.length)fail('IMMUTABLE_WORKFLOW_DENIED');
 const receipts=new Map();for(const row of b.workflowReceipts){if(receipts.has(row.request_key))fail('IMMUTABLE_WORKFLOW_CORRUPT');receipts.set(row.request_key,row);}
 const authors=new Map();for(const x of b.operationAuthors){exact(x,['revision','receiptKey','authority','recordSha256','previousSha256','manifestId']);if(!Number.isSafeInteger(x.revision)||x.revision<0||authors.has(x.revision)||!SHA.test(x.recordSha256))fail('IMMUTABLE_WORKFLOW_CORRUPT');tuple(x.authority);authors.set(x.revision,x);}
 let prior=null;for(let i=0;i<b.workflowRows.length;i++){
  const row=b.workflowRows[i];exact(row,['revision','record','sha256','previous_sha256','receipt_key']);const r=validatePreparedWorkflowRecord(row.record,a.scope);
  if(row.revision!==i||r.revision!==i||r.store!==a.actor.store||row.sha256!==hash(r)||row.previous_sha256!==(prior?hash(prior):null)||!equal(r.legacyVersions,b.legacyVersions))fail('IMMUTABLE_WORKFLOW_CORRUPT');
  if(r.photoRefs.length||r.modelCandidates?.length)fail('IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED');
  if(!prior){if(row.receipt_key!==null||r.session.revision!==0||r.archives.length)fail('IMMUTABLE_WORKFLOW_CORRUPT');}
  else{const rr=receipts.get(row.receipt_key);if(!rr||rr.record_sha256!==row.sha256)fail('IMMUTABLE_WORKFLOW_CORRUPT');const p=receipt(rr,a.scope,i);if(!equal(replayPreparedWorkflowIntentAgainstValidated({prior,request:p.request,mediaReferences:null,trustedCandidate:null,expected:r}),r))fail('IMMUTABLE_WORKFLOW_CORRUPT');}
  if(i>base){const x=authors.get(i);if(!x||!equal(tuple(x.authority),a)||x.recordSha256!==row.sha256||x.previousSha256!==row.previous_sha256||x.receiptKey!==row.receipt_key||x.manifestId!==(b.manifest?.id??null))fail('IMMUTABLE_WORKFLOW_DENIED');}
  prior=r;
 }
 for(const [revision] of authors)if(revision>=b.workflowRows.length)fail('IMMUTABLE_WORKFLOW_CORRUPT');
 if(b.fullRows.length){const versions=b.fullRows.map(row=>{exact(row,['version','record','sha256']);if(row.version!==row.record?.version||row.sha256!==row.record?.sha256)fail('IMMUTABLE_WORKFLOW_CORRUPT');if(row.record.snapshot?.photoRefs?.length||row.record.snapshot?.modelCandidates?.length)fail('IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED');return row.record;});validateFullWorkflowChain(versions,a.scope);for(let i=0;i<versions.length;i++){const v=versions[i],row=b.fullReceipts.find(x=>x.request_key===hash([v.actor,v.requestId]));if(!row)fail('IMMUTABLE_WORKFLOW_CORRUPT');exact(row,['request_key','receipt']);const expectedReceipt={requestKey:row.request_key,fingerprint:hash({actor:v.actor,scope:a.scope,requestId:v.requestId,expectedVersion:v.version-1,expectedParentDigest:v.previous?.sha256??null,snapshotSha256:v.snapshot.sha256}),scope:a.scope,version:v.version,sha256:v.sha256};if(!equal(row.receipt,expectedReceipt))fail('IMMUTABLE_WORKFLOW_CORRUPT');}}
 return freeze(b);
}

/** runRequest must encompass a fixed service operation, never a browser callback. */
export function createImmutableWorkflowRepository({enabled=false,acquireClient}={}){
 const local=new AsyncLocalStorage(),leased=new WeakSet();
 const state=()=>{const s=local.getStore();if(!s||s.closed)fail('IMMUTABLE_WORKFLOW_TRANSACTION');return s;};
 function pin(a){const s=state();if(!equal(a.scope,s.scope)||s.authority&&!equal(s.authority,a))fail('IMMUTABLE_WORKFLOW_CHANGED');s.authority??=a;return a;}
 async function transact(work){
  if(enabled!==true||typeof acquireClient!=='function')fail('IMMUTABLE_WORKFLOW_DISABLED');const s=state();let client,owned=false,started=false,commitAttempted=false,committed=false,closed=false,busy=false,poison=false,finalizing=false;const hooks=[];
  const idle=()=>{if(closed||busy||poison){poison=true;fail('IMMUTABLE_WORKFLOW_TRANSACTION');}};
  const query=async(sql,params=[])=>{idle();busy=true;try{return await client.query(sql,params);}catch(e){poison=true;throw e;}finally{busy=false;}};
  try{
   client=await acquireClient();if(!client||typeof client.query!=='function'||typeof client.release!=='function'||leased.has(client))fail('IMMUTABLE_WORKFLOW_TRANSACTION');leased.add(client);owned=true;
   started=true;if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('IMMUTABLE_WORKFLOW_TRANSACTION');
   await query("SET LOCAL statement_timeout='30000ms'");await query("SET LOCAL lock_timeout='5000ms'");await query("SET LOCAL idle_in_transaction_session_timeout='30000ms'");await query('SET LOCAL search_path=pg_catalog');
   await query("SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) AS locked");
   const ops=createWorkflowAuthorityCapabilities({query}),authority=pin(tuple(await ops.authorize({credential:s.credential,scope:s.scope})));
   const read=async()=>{idle();return validateAuthorizedWorkflowBundle(await ops.readBundle(),authority);};
   const recheck=async()=>{idle();pin(tuple(await ops.recheck(authority)));};
   const tx={ops,authority,read,recheck,beforeCommit:guard=>{idle();if(finalizing||hooks.length>=1||typeof guard!=='function'){poison=true;fail('IMMUTABLE_WORKFLOW_TRANSACTION');}hooks.push(guard);}};
   const result=await work(tx);idle();finalizing=true;for(const hook of hooks){await hook();idle();}await recheck();await read();await ops.clear();idle();
   commitAttempted=true;if((await query('COMMIT')).command!=='COMMIT')fail('IMMUTABLE_WORKFLOW_TRANSACTION');committed=true;closed=true;return result;
  }catch(e){closed=true;let uncertain=busy;if(owned&&started&&!committed&&!busy)try{if((await client.query('ROLLBACK',[])).command!=='ROLLBACK')uncertain=true;}catch{uncertain=true;}if(commitAttempted||uncertain)fail('IMMUTABLE_WORKFLOW_UNCERTAIN');if(e instanceof ImmutableWorkflowError)throw new ImmutableWorkflowError(e.code);fail('IMMUTABLE_WORKFLOW_DENIED');}
  finally{closed=true;if(owned)try{await client.release(committed?undefined:new Error('Discard immutable workflow lease'));leased.delete(client);}catch{fail('IMMUTABLE_WORKFLOW_UNCERTAIN');}}
 }
 const permissionGate=Object.freeze({async authorize(credential,scope){const s=state();if(credential!==s.credential||!equal(scope,s.scope))fail('IMMUTABLE_WORKFLOW_DENIED');return transact(async tx=>{await tx.read();return grant(tx.authority);});}});
 const repository=Object.freeze({async transaction(context,work){const s=state();const c=copyJSON(context,8192);exact(c,['grant','scope']);if(!equal(c.scope,s.scope)||!equal(c.grant,grant(s.authority)))fail('IMMUTABLE_WORKFLOW_DENIED');return transact(async base=>{
  const gate=Object.freeze({async authorize(token,scope){if(token!==s.credential||!equal(scope,s.scope))fail('IMMUTABLE_WORKFLOW_DENIED');await base.recheck();return grant(base.authority);}});
  const tx=Object.freeze({permissionGate:gate,beforeCommit:base.beforeCommit,
   async read(){const b=await base.read();if(!b.workflowRows.length)fail('IMMUTABLE_WORKFLOW_DENIED');return b.workflowRows.at(-1).record;},
   async findReceipt(key){const b=await base.read(),r=b.workflowReceipts.find(r=>r.request_key===key);if(!r)return null;const author=b.operationAuthors.find(x=>x.revision===r.receipt.appliedRevision);if(!author||!equal(tuple(author.authority),base.authority))fail('IMMUTABLE_WORKFLOW_DENIED');return r.receipt;},
   async write(input){const v=copyJSON(input);exact(v,['expectedRevision','record','receiptKey','receipt']);assertImmutableWorkflowIntent(v.receipt?.request?.intent);const b=await base.read(),old=b.workflowRows.at(-1)?.record;if(!old||old.revision!==v.expectedRevision)return false;const next=validatePreparedWorkflowRecord(v.record,s.scope);if(!equal(applyPreparedWorkflowIntent(old,v.receipt.request,null,null),next)||!equal(v.receipt.actor,base.authority.actor))fail('IMMUTABLE_WORKFLOW_CORRUPT');receipt({request_key:v.receiptKey,receipt:v.receipt,record_sha256:hash(next)},s.scope,next.revision);return base.ops.appendNative({expectedSourceFingerprint:b.sourceFingerprint,expectedRevision:v.expectedRevision,record:next,recordSha256:hash(next),receiptKey:v.receiptKey,receipt:v.receipt});}
  });return work(tx);
 });}});
 return Object.freeze({permissionGate,repository,
  async runRequest(request,work){if(enabled!==true)fail('IMMUTABLE_WORKFLOW_DISABLED');const r=copyJSON(request,8192);exact(r,['credential','scope']);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/\s/.test(r.credential)||typeof work!=='function'||local.getStore())fail('IMMUTABLE_WORKFLOW_INVALID');r.scope=validateProductionDesignScope(r.scope);const s={...r,authority:null,closed:false};try{return await local.run(s,work);}finally{s.closed=true;}},
  async initialize(){return transact(async tx=>{const b=await tx.read();if(b.workflowRows.length)return b.workflowRows.at(-1).record;const record=createPreparedWorkflowRecord({scope:tx.authority.scope,store:tx.authority.actor.store,session:createDesignSession({customerId:tx.authority.scope.customerProfileId,visitId:tx.authority.scope.visitId,sessionId:'prepared-'+randomUUID()}),legacyVersions:b.legacyVersions});if(await tx.ops.initializeNative({expectedSourceFingerprint:b.sourceFingerprint,record,recordSha256:hash(record)})!==true)fail('IMMUTABLE_WORKFLOW_CHANGED');return record;});}
 });
}
