import {PHONE_SOURCE_MIMES} from '../shared/phone-image-types.mjs';
import {createManagedApplicationViewWorkflowAuthority} from './managed-application-view-workflow-authority.mjs';
import {createManagedApplicationWorkflowAuthority} from './managed-application-workflow-authority.mjs';
import {createBrowserArchiveCommandAuthority} from './browser-archive-command-authority.mjs';
import {createManagedNormalizedWorkflowAuthority} from './managed-normalized-workflow-authority.mjs';
import {createManagedViewWorkflowAuthority} from './managed-view-workflow-authority.mjs';
import {createManagedWorkflowAuthority} from './managed-workflow-authority.mjs';
/** Dependency workflow adapter for fixed PG capabilities. No legacy executor fallback. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequestLocalDerivedSnapshot} from './request-local-derived-snapshot.mjs';
import {randomUUID} from 'node:crypto';
import {createDependencyAuthorityCapabilities} from './dependency-authority-capabilities.mjs';
import {artifactCopy as copyJSON} from './postgres-artifact-access-repository.mjs';
import {policyCanonical,policyDigest,policyEqual,policyFreeze} from './approval-attempt-contracts.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
import {createDesignSession} from '../analysis-engine/design-pilot.mjs';
import {PREPARED_RECORD_SCHEMA,validatePreparedWorkflowRecord,replayPreparedWorkflowIntentAgainstValidated,applyPreparedWorkflowIntent} from './prepared-workflow-service.mjs';
import {withFullWorkflowSnapshotValidation,createFullWorkflowSnapshot,validateFullWorkflowChain,validateFullWorkflowSnapshot,createPreparedFullWorkflowArchive,FullWorkflowArchiveError} from './full-workflow-archive.mjs';
import {validateDesignCandidate,validateSynthesisEvidence,validateSynthesisContext} from '../analysis-engine/design-candidate.mjs';
import {reconstructCandidateSessionPrefix,validateDesignCandidatePhotoRefs} from '../analysis-engine/design-candidate-history.mjs';
const bundleClockFloors=new WeakMap();
function candidateNow(b){const floor=bundleClockFloors.get(b);if(floor===undefined)return Date.now();const now=Date.now();if(!Number.isSafeInteger(now)||now<1)fail('IMMUTABLE_DEPENDENCY_DENIED');return Math.max(now,floor);}
const SHA=/^[a-f0-9]{64}$/;
const TYPES=new Set(['record_source','record_note','advance','create_group','record_technique','record_context','record_review','confirm_entry','archive','reopen','attach_media','accept_model_candidate','accept_managed_candidate','accept_managed_view_candidate','accept_normalized_candidate','accept_application_candidate','accept_application_view_candidate']);
const CODES=new Set(['IMMUTABLE_DEPENDENCY_DISABLED','IMMUTABLE_DEPENDENCY_INVALID','IMMUTABLE_DEPENDENCY_DENIED','IMMUTABLE_DEPENDENCY_DEPENDENCY_UNSUPPORTED','IMMUTABLE_DEPENDENCY_CORRUPT','IMMUTABLE_DEPENDENCY_CHANGED','IMMUTABLE_DEPENDENCY_TRANSACTION','IMMUTABLE_DEPENDENCY_UNCERTAIN']);
export class ImmutableDependencyError extends Error{constructor(code){super(CODES.has(code)?code:'IMMUTABLE_DEPENDENCY_DENIED');this.name='ImmutableDependencyError';this.code=this.message;this.retryable=false;this.outcome=this.code==='IMMUTABLE_DEPENDENCY_UNCERTAIN'?'uncertain':'withheld';}}
const fail=code=>{throw new ImmutableDependencyError(code);};
const exact=(v,keys)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('IMMUTABLE_DEPENDENCY_INVALID');};
const equal=policyEqual,hash=policyDigest,freeze=policyFreeze;
// Private pure namespace. Handles can only originate from the original record
// validator; no caller-supplied digest/brand or bundle/access result is memoized.
const derivedSnapshots=createRequestLocalDerivedSnapshot({validateRecord:validatePreparedWorkflowRecord,createSnapshot:record=>snapshotOf(record)});
const tuple=a=>{const v=validateImmutableDesignAuthority(a);return v;};
const grant=a=>freeze({actor:a.actor,scope:a.scope});
export function assertImmutableDependencyIntent(intent){const v=copyJSON(intent,16384);if(!TYPES.has(v?.type))fail('IMMUTABLE_DEPENDENCY_DEPENDENCY_UNSUPPORTED');return v;}
function receipt(row,scope,revision){
 exact(row,['request_key','receipt','record_sha256']);const r=row.receipt;exact(r,['fingerprint','scope','actor','appliedRevision','request']);exact(r.actor,['username','store']);exact(r.request,['requestId','expectedRevision','intent']);
 if(!equal(r.scope,scope)||r.appliedRevision!==revision||r.request.expectedRevision!==revision-1||!SHA.test(row.record_sha256)||row.request_key!==hash([r.actor,r.request.requestId])||r.fingerprint!==hash({scope,...r.request}))fail('IMMUTABLE_DEPENDENCY_CORRUPT');assertImmutableDependencyIntent(r.request.intent);return r;
}
/** Full native replay, not a trusted-mark/SQL-authority cache. */
export function validateAuthorizedDependencyBundle(input,expected){
 const b=copyJSON(input),a=tuple(expected);exact(b,['schemaVersion','authority','manifest','sourceFingerprint','workflowRows','workflowReceipts','legacyVersions','legacyPhotos','fullRows','fullReceipts','mediaRows','candidateRows','operationAuthors','dependencyAuthors']);
 if(b.schemaVersion!=='design-authorized-dependency-bundle-v1'||!equal(tuple(b.authority),a)||!SHA.test(b.sourceFingerprint))fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 for(const k of ['workflowRows','workflowReceipts','legacyVersions','legacyPhotos','fullRows','fullReceipts','mediaRows','candidateRows','operationAuthors','dependencyAuthors'])if(!Array.isArray(b[k]))fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 if(b.workflowRows.length>1001||b.legacyVersions.length>1000||b.fullRows.length>100||b.workflowReceipts.length!==Math.max(0,b.workflowRows.length-1)||b.fullReceipts.length!==b.fullRows.length)fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 if(b.mediaRows.length>300||b.candidateRows.length>1000||b.legacyPhotos.length>300)fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 let base=-1;
 if(b.manifest!==null){const m=b.manifest;exact(m,['id','revision','reader','baseWorkflowRevision','baseWorkflowSha256','sourceFingerprint','expiresAt','baseDependencyDigests']);if(typeof m.id!=='string'||!m.id||!Number.isSafeInteger(m.revision)||m.revision<1||!equal(tuple(m.reader),a)||!Number.isSafeInteger(m.baseWorkflowRevision)||m.baseWorkflowRevision< -1||!SHA.test(m.sourceFingerprint)||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=Date.now())fail('IMMUTABLE_DEPENDENCY_DENIED');base=m.baseWorkflowRevision;if(base>=0?b.workflowRows[base]?.sha256!==m.baseWorkflowSha256:m.baseWorkflowSha256!==null)fail('IMMUTABLE_DEPENDENCY_CORRUPT');}
 else if(b.legacyVersions.length||b.legacyPhotos.length)fail('IMMUTABLE_DEPENDENCY_DENIED');
 validateDependencies(b,a);
 const receipts=new Map();for(const row of b.workflowReceipts){if(receipts.has(row.request_key))fail('IMMUTABLE_DEPENDENCY_CORRUPT');receipts.set(row.request_key,row);}
 const authors=new Map();for(const x of b.operationAuthors){exact(x,['revision','receiptKey','authority','recordSha256','previousSha256','manifestId']);if(!Number.isSafeInteger(x.revision)||x.revision<0||authors.has(x.revision)||!SHA.test(x.recordSha256))fail('IMMUTABLE_DEPENDENCY_CORRUPT');tuple(x.authority);authors.set(x.revision,x);}
 const checkedRecords=b.fullRows.length?[]:null;
 let prior=null;for(let i=0;i<b.workflowRows.length;i++){
  const row=b.workflowRows[i];exact(row,['revision','record','sha256','previous_sha256','receipt_key']);
  const proof=checkedRecords?derivedSnapshots.validate(row.record,a.scope):null,r=proof?proof.record:validatePreparedWorkflowRecord(row.record,a.scope);if(proof)checkedRecords.push(proof);
  if(row.revision!==i||r.revision!==i||r.store!==a.actor.store||row.sha256!==hash(r)||row.previous_sha256!==(prior?hash(prior):null)||!equal(r.legacyVersions,b.legacyVersions))fail('IMMUTABLE_DEPENDENCY_CORRUPT');
  verifyStoredPhotos(b,r.photoRefs,false);
  for(const accepted of r.modelCandidates||[])verifyAccepted(b,accepted,r);
  verifyManagedWorkflowBindings(b,r);
  if(!prior){if(row.receipt_key!==null||r.session.revision!==0||r.archives.length)fail('IMMUTABLE_DEPENDENCY_CORRUPT');}
  else{const rr=receipts.get(row.receipt_key);if(!rr||rr.record_sha256!==row.sha256)fail('IMMUTABLE_DEPENDENCY_CORRUPT');const p=receipt(rr,a.scope,i);if(!equal(replayPreparedWorkflowIntentAgainstValidated({prior,request:p.request,mediaReferences:p.request.intent.type==='attach_media'?r.photoRefs.slice(prior.photoRefs.length).map(p=>p.reference):null,trustedCandidate:p.request.intent.type==='accept_model_candidate'?r.modelCandidates?.at(-1)?.candidate:p.request.intent.type==='accept_managed_candidate'?managedReplayInput(r):p.request.intent.type==='accept_managed_view_candidate'?managedViewReplayInput(r):p.request.intent.type==='accept_normalized_candidate'?normalizedReplayInput(r):p.request.intent.type==='accept_application_candidate'?applicationReplayInput(r):p.request.intent.type==='accept_application_view_candidate'?applicationViewReplayInput(r):null,expected:r}),r))fail('IMMUTABLE_DEPENDENCY_CORRUPT');}
  if(i>base){const x=authors.get(i);if(!x||!equal(tuple(x.authority),a)||x.recordSha256!==row.sha256||x.previousSha256!==row.previous_sha256||x.receiptKey!==row.receipt_key||x.manifestId!==(b.manifest?.id??null))fail('IMMUTABLE_DEPENDENCY_DENIED');}
  prior=r;
 }
 for(const [revision] of authors)if(revision>=b.workflowRows.length)fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 if(b.fullRows.length){const versions=b.fullRows.map(row=>{exact(row,['version','record','sha256']);if(row.version!==row.record?.version||row.sha256!==row.record?.sha256)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return row.record;});validateFullWorkflowChain(versions,a.scope);for(const v of versions){verifyStoredPhotos(b,v.snapshot.photoRefs,false);if(!checkedRecords.some(r=>equal(r.snapshot(),v.snapshot)))fail('IMMUTABLE_DEPENDENCY_CORRUPT');}for(let i=0;i<versions.length;i++){const v=versions[i],row=b.fullReceipts.find(x=>x.request_key===hash([v.actor,v.requestId]));if(!row)fail('IMMUTABLE_DEPENDENCY_CORRUPT');exact(row,['request_key','receipt']);const expectedReceipt={requestKey:row.request_key,fingerprint:hash({actor:v.actor,scope:a.scope,requestId:v.requestId,expectedVersion:v.version-1,expectedParentDigest:v.previous?.sha256??null,snapshotSha256:v.snapshot.sha256}),scope:a.scope,version:v.version,sha256:v.sha256};if(!equal(row.receipt,expectedReceipt))fail('IMMUTABLE_DEPENDENCY_CORRUPT');}}
 return freeze(b);
}

const snapshotOf=r=>createFullWorkflowSnapshot({scope:r.scope,store:r.store,bindings:{uiScope:null,evidenceScope:r.session.scope},ui:null,evidence:{session:r.session,archives:r.archives},legacyVersions:r.legacyVersions,photoRefs:r.photoRefs,...(r.modelCandidates?{modelCandidates:r.modelCandidates}:{}),...(r.managedImageHistory?{managedImageHistory:r.managedImageHistory}:{})});
// Snapshot validation alone cannot authenticate a prior workflow digest. Bind
// each managed acceptance to the actual immutable row and original author.
function verifyManagedWorkflowBindings(b,record){
 for(const accepted of record.managedImageHistory?.accepted||[]){
  const c=accepted.candidate,w=c.workflowBinding,row=b.workflowRows[w.recordRevision];
  const author=b.operationAuthors.find(x=>x.revision===accepted.acceptance.workflowRevision);
  if(!row||row.sha256!==w.recordDigest||row.record.session.scope.sessionId!==w.sessionId||row.record.session.revision!==w.sessionRevision||hash(row.record.session)!==w.sessionDigest||accepted.acceptance.workflowRevision!==w.recordRevision+1||!author||!equal(author.authority,accepted.acceptance.authority)||!equal(c.authority,accepted.acceptance.authority))fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 }
 return true;
}
function managedReplayInput(record){
 const accepted=record.managedImageHistory?.accepted.at(-1);
 if(!accepted)fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 const input=record.managedImageHistory.inputs.find(x=>x.taskId===accepted.candidate.imageBinding.taskId);
 if(!input)fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 return {candidate:accepted.candidate,input};
}
function managedViewReplayInput(record){const accepted=record.managedImageHistory?.accepted.at(-1);if(!accepted||accepted.candidate.schemaVersion!=='design-managed-model-candidate-v2')fail('IMMUTABLE_DEPENDENCY_CORRUPT');const inputs=(accepted.candidate.evidenceBinding.images||[]).map(b=>{const input=record.managedImageHistory.inputs.find(x=>x.taskId===b.taskId);if(!input)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return input;});return {candidate:accepted.candidate,inputs};}
function applicationViewReplayInput(record){const accepted=record.managedImageHistory?.accepted.at(-1);if(!accepted||accepted.candidate.schemaVersion!=='design-managed-model-candidate-v6')fail('IMMUTABLE_DEPENDENCY_CORRUPT');const inputs=(accepted.candidate.evidenceBinding.images||[]).map(b=>{const input=record.managedImageHistory.inputs.find(x=>x.taskId===b.taskId);if(!input)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return input;});return {candidate:accepted.candidate,inputs};}
function normalizedReplayInput(record){const accepted=record.managedImageHistory?.accepted.at(-1);if(!accepted||accepted.candidate.schemaVersion!=='design-managed-model-candidate-v4')fail('IMMUTABLE_DEPENDENCY_CORRUPT');const input=record.managedImageHistory.inputs.find(x=>x.taskId===accepted.candidate.normalizedBinding.input.taskId);if(!input)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return {candidate:accepted.candidate,input};}
function applicationReplayInput(record){const accepted=record.managedImageHistory?.accepted.at(-1);if(!accepted||accepted.candidate.schemaVersion!=='design-managed-model-candidate-v5')fail('IMMUTABLE_DEPENDENCY_CORRUPT');const input=record.managedImageHistory.inputs.find(x=>x.taskId===accepted.candidate.applicationBinding.input.taskId);if(!input)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return {candidate:accepted.candidate,input};}
const mediaReference=r=>Object.fromEntries(['mediaId','stage','angle','mime','byteLength','width','height'].map(k=>[k,r[k]]));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function checkedMedia(r){
 exact(r,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);exact(r.binding,['owner','store','scope']);validateProductionDesignScope(r.binding.scope);
 if(!id(r.mediaId)||r.requestId!==r.mediaId||!['before','after','reference'].includes(r.stage)||!['front','back','left','right','detail'].includes(r.angle)||!PHONE_SOURCE_MIMES.includes(r.mime)||!Number.isSafeInteger(r.byteLength)||r.byteLength<1||r.byteLength>8388608||!Number.isSafeInteger(r.width)||!Number.isSafeInteger(r.height)||r.width<1||r.height<1||r.width>16384||r.height>16384||r.width*r.height>40000000||!SHA.test(r.sha256)||r.active!==true||typeof r.binding.owner!=='string'||!r.binding.owner||typeof r.binding.store!=='string'||!r.binding.store)fail('IMMUTABLE_DEPENDENCY_CORRUPT');return r;
}
function validateDependencies(b,a){
 const actual=new Map(),add=(kind,id,sha256)=>{const key=kind+':'+id;if(actual.has(key)||typeof id!=='string'||!id||!SHA.test(sha256))fail('IMMUTABLE_DEPENDENCY_CORRUPT');actual.set(key,sha256);};
 for(const row of b.mediaRows){exact(row,['binding_key','media_id','record','record_sha256','active','access_revision']);const r=checkedMedia(row.record);if(row.media_id!==r.mediaId||row.binding_key!==hash(r.binding)||row.record_sha256!==hash(r)||!equal(r.binding.scope,a.scope)||r.binding.store!==a.actor.store||typeof row.active!=='boolean'||!Number.isSafeInteger(row.access_revision)||row.access_revision<1)fail('IMMUTABLE_DEPENDENCY_CORRUPT');add('media',row.binding_key+':'+row.media_id,row.record_sha256);}
 const latest=b.workflowRows.at(-1)?.record;
 for(const row of b.candidateRows){exact(row,['candidate_id','scope_key','envelope','sha256','expiresAt','active','access_revision','consumed']);const c=row.envelope;if(!latest||row.candidate_id!==c?.id||row.scope_key!==hash(a.scope)||row.sha256!==hash(c)||!equal(c.scope,a.scope)||c.store!==a.actor.store||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<1||typeof row.active!=='boolean'||!Number.isSafeInteger(row.access_revision)||row.access_revision<1)fail('IMMUTABLE_DEPENDENCY_CORRUPT');const session=reconstructCandidateSessionPrefix(latest.session,c.baseRevision);validateDesignCandidate(c,session);validateSynthesisEvidence({candidate:c,session,modelCandidates:latest.modelCandidates||[]});validateDesignCandidatePhotoRefs({candidate:c,photoRefs:latest.photoRefs,scope:a.scope,store:a.actor.store});for(const ref of c.sourceRefs){const media=b.mediaRows.find(m=>m.media_id===ref.mediaId&&m.record.binding.owner===c.actor.username);if(!media||media.record.sha256!==ref.sourceSha256)fail('IMMUTABLE_DEPENDENCY_CORRUPT');}if(row.consumed!==null){const accepted=latest.modelCandidates?.find(x=>x.candidate.id===c.id);if(!accepted)fail('IMMUTABLE_DEPENDENCY_CORRUPT');verifyAccepted(b,accepted,latest);}add('candidate',c.id,row.sha256);}
 for(const row of b.fullRows)add('full',String(row.version),row.sha256);
 const baseline=new Map();for(const x of b.manifest?.baseDependencyDigests||[]){exact(x,['kind','id','sha256']);const k=x.kind+':'+x.id;if(!['media','candidate','full'].includes(x.kind)||baseline.has(k)||actual.get(k)!==x.sha256)fail('IMMUTABLE_DEPENDENCY_DENIED');baseline.set(k,x.sha256);}
 if(b.manifest&&!Array.isArray(b.manifest.baseDependencyDigests))fail('IMMUTABLE_DEPENDENCY_CORRUPT');
 const authors=new Map();for(const x of b.dependencyAuthors){exact(x,['kind','id','authority','sha256','manifestId']);const k=x.kind+':'+x.id;tuple(x.authority);if(authors.has(k)||actual.get(k)!==x.sha256)fail('IMMUTABLE_DEPENDENCY_CORRUPT');authors.set(k,x);}
 for(const [k,digest] of actual){if(baseline.get(k)===digest)continue;const author=authors.get(k);if(!author||!equal(tuple(author.authority),a)||author.manifestId!==(b.manifest?.id??null))fail('IMMUTABLE_DEPENDENCY_DENIED');}
}
function verifyStoredPhotos(b,photos,active=true){for(const p of photos){if(!equal(p.scope,b.authority.scope)||p.store!==b.authority.actor.store)fail('IMMUTABLE_DEPENDENCY_DENIED');if(p.kind==='legacy_asset'){if(!b.legacyPhotos.some(x=>equal(x,p)))fail('IMMUTABLE_DEPENDENCY_DENIED');}else if(p.kind==='private_media'){const rows=b.mediaRows.filter(m=>m.media_id===p.reference.mediaId&&equal(mediaReference(m.record),p.reference));if(rows.length!==1||active&&(!rows[0].active||rows[0].record.binding.owner!==b.authority.actor.username))fail('IMMUTABLE_DEPENDENCY_DENIED');}else fail('IMMUTABLE_DEPENDENCY_CORRUPT');}return true;}
function verifyAccepted(b,accepted,record){const row=b.candidateRows.find(x=>x.candidate_id===accepted.candidate.id);const expected={scope:record.scope,candidateId:accepted.candidate.id,candidateDigest:hash(accepted.candidate),receiptKey:hash([accepted.candidate.actor,accepted.acceptance.requestId]),acceptance:accepted.acceptance};if(!row||!equal(row.envelope,accepted.candidate)||!equal(row.consumed,expected))fail('IMMUTABLE_DEPENDENCY_CORRUPT');}
function currentRecord(b){const r=b.workflowRows.at(-1)?.record;if(!r)fail('IMMUTABLE_DEPENDENCY_DENIED');return r;}
function mediaRefs(b,ids){if(!Array.isArray(ids)||ids.length>300||new Set(ids).size!==ids.length||!ids.every(id))fail('IMMUTABLE_DEPENDENCY_INVALID');return ids.map(id=>{const row=b.mediaRows.find(m=>m.media_id===id&&m.record.binding.owner===b.authority.actor.username);if(!row||!row.active)fail('IMMUTABLE_DEPENDENCY_DENIED');return mediaReference(row.record);});}
function checkCandidateMedia(b,c,r){validateDesignCandidatePhotoRefs({candidate:c,photoRefs:r.photoRefs,scope:r.scope,store:r.store});for(const ref of c.sourceRefs){const row=b.mediaRows.find(m=>m.media_id===ref.mediaId&&m.record.binding.owner===b.authority.actor.username),photo=r.photoRefs.find(p=>p.kind==='private_media'&&p.reference.mediaId===ref.mediaId);if(!row?.active||row.record.sha256!==ref.sourceSha256||!photo||!equal(photo.reference,mediaReference(row.record)))fail('IMMUTABLE_DEPENDENCY_DENIED');}return true;}
function checkAncestors(b,c,r){if(c.kind!=='completion_synthesis')return true;const refs=[];for(const e of c.synthesis.evidence){const row=b.candidateRows.find(x=>x.candidate_id===e.candidateId),accepted=r.modelCandidates?.find(x=>x.candidate.id===e.candidateId);if(!row?.active||!accepted||!equal(row.envelope.actor,b.authority.actor)||hash(row.envelope)!==e.candidateDigest)fail('IMMUTABLE_DEPENDENCY_DENIED');verifyAccepted(b,accepted,r);checkCandidateMedia(b,row.envelope,r);refs.push(...row.envelope.sourceRefs);}if(!equal(refs,c.sourceRefs))fail('IMMUTABLE_DEPENDENCY_DENIED');return true;}
function candidateAt(b,id,{pending=false,current=false,ancestors=false}={}){const r=currentRecord(b),row=b.candidateRows.find(x=>x.candidate_id===id);if(!row?.active||!equal(row.envelope.actor,b.authority.actor)||pending&&row.consumed||(!row.consumed||pending)&&row.expiresAt<=candidateNow(b))fail('IMMUTABLE_DEPENDENCY_DENIED');if(pending||!row.consumed){const author=b.dependencyAuthors.find(x=>x.kind==='candidate'&&x.id===id);if(!author||!equal(author.authority,b.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');}const c=row.envelope,session=pending||current?r.session:reconstructCandidateSessionPrefix(r.session,c.baseRevision);validateDesignCandidate(c,session);validateSynthesisEvidence({candidate:c,session,modelCandidates:r.modelCandidates||[]});checkCandidateMedia(b,c,r);if(pending||!row.consumed||ancestors)checkAncestors(b,c,r);return c;}

function checkNewAcceptance(b,{candidate,acceptance}){const row=b.candidateRows.find(x=>x.candidate_id===candidate.id),author=b.dependencyAuthors.find(x=>x.kind==='candidate'&&x.id===candidate.id),r=currentRecord(b);if(!row?.active||row.expiresAt<=candidateNow(b)||!author||!equal(author.authority,b.authority)||!equal(row.envelope,candidate))fail('IMMUTABLE_DEPENDENCY_DENIED');verifyAccepted(b,{candidate,acceptance},r);checkCandidateMedia(b,candidate,r);checkAncestors(b,candidate,r);return true;}

/** runRequest must encompass a fixed service operation, never a browser callback. */
export function createImmutableDependencyRepository({enabled=false,acquireClient,proofReadsEnabled=false,managedCandidatesEnabled=false,managedViewsEnabled=false,managedNormalizedEnabled=false,managedApplicationEnabled=false,managedApplicationViewsEnabled=false,browserArchivesEnabled=false}={}){
 const local=new AsyncLocalStorage(),leased=new WeakSet(),contexts=new WeakMap();
 const state=()=>{const s=local.getStore();if(!s||s.closed)fail('IMMUTABLE_DEPENDENCY_TRANSACTION');return s;};
 function pin(a){const s=state();if(!equal(a.scope,s.scope)||s.authority&&!equal(s.authority,a))fail('IMMUTABLE_DEPENDENCY_CHANGED');s.authority??=a;return a;}
 async function transact(work){
  if(enabled!==true||typeof acquireClient!=='function')fail('IMMUTABLE_DEPENDENCY_DISABLED');const s=state();let client,owned=false,started=false,commitAttempted=false,committed=false,closed=false,busy=false,poison=false,finalizing=false;const hooks=[],candidateRequirements=[],candidatePreviews=[],managedRequirements=[],managedViewRequirements=[],normalizedRequirements=[],applicationRequirements=[],applicationViewRequirements=[];
  const idle=()=>{if(closed||busy||poison){poison=true;fail('IMMUTABLE_DEPENDENCY_TRANSACTION');}};
  const query=async(sql,params=[])=>{idle();busy=true;try{return await client.query(sql,params);}catch(e){poison=true;throw e;}finally{busy=false;}};
  try{
   client=await acquireClient();if(!client||typeof client.query!=='function'||typeof client.release!=='function'||leased.has(client))fail('IMMUTABLE_DEPENDENCY_TRANSACTION');leased.add(client);owned=true;
   started=true;if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('IMMUTABLE_DEPENDENCY_TRANSACTION');
   await query("SET LOCAL statement_timeout='30000ms'");await query("SET LOCAL lock_timeout='5000ms'");await query("SET LOCAL idle_in_transaction_session_timeout='30000ms'");await query('SET LOCAL search_path=pg_catalog');
   await query("SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) AS locked");
   const managedOps=managedCandidatesEnabled===true||managedViewsEnabled===true||managedNormalizedEnabled===true||managedApplicationEnabled===true||managedApplicationViewsEnabled===true?createManagedWorkflowAuthority({query}):null,managedViewOps=managedViewsEnabled===true?createManagedViewWorkflowAuthority({query}):null,normalizedOps=managedNormalizedEnabled===true||managedApplicationEnabled===true||managedApplicationViewsEnabled===true?createManagedNormalizedWorkflowAuthority({query}):null,applicationOps=managedApplicationEnabled===true||managedApplicationViewsEnabled===true?createManagedApplicationWorkflowAuthority({query}):null,applicationViewOps=managedApplicationViewsEnabled===true?createManagedApplicationViewWorkflowAuthority({query}):null;
   const verifyHistory=async history=>{const selected=history.schemaVersion==='design-managed-image-history-v5'?applicationViewOps:history.schemaVersion==='design-managed-image-history-v4'?applicationOps:history.schemaVersion==='design-managed-image-history-v3'?normalizedOps:managedOps;if(!selected||await selected.verifyHistory({managedImageHistory:history})!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');return true;};
   const ops=createDependencyAuthorityCapabilities({query}),authority=pin(tuple(await ops.authorize({credential:s.credential,scope:s.scope})));
   const read=async()=>{
    idle();
    if(proofReadsEnabled===true&&s.validatedBundle){
     // A new same-connection SQL call still executes the ORIGINAL full SQL
     // source/authority/media/manifest checks. Only immutable JS structure is reused.
     const proof=await ops.readBundleProof(),prior=s.validatedBundle;
     if(s.proofCheckedAt!==null&&proof.checkedAt<s.proofCheckedAt)fail('IMMUTABLE_DEPENDENCY_DENIED');s.proofCheckedAt=proof.checkedAt;
     if(equal(proof.authority,authority)&&proof.sourceFingerprint===prior.sourceFingerprint&&equal(proof.manifest,prior.manifest)){
      const localNow=Date.now();if(!Number.isSafeInteger(localNow)||localNow<1||prior.manifest&&prior.manifest.expiresAt<=Math.max(localNow,proof.checkedAt))fail('IMMUTABLE_DEPENDENCY_DENIED');
      const history=prior.workflowRows.at(-1)?.record.managedImageHistory;if(history)await verifyHistory(history);bundleClockFloors.set(prior,proof.checkedAt);return prior;
     }
     s.validatedBundle=null;
    }
    const checked=validateAuthorizedDependencyBundle(await ops.readBundle(),authority);
    const history=checked.workflowRows.at(-1)?.record.managedImageHistory;if(history)await verifyHistory(history);
    // At most one bounded deep-frozen structural baseline per runRequest. An
    // oversized valid bundle remains valid, but always follows the original path.
    if(proofReadsEnabled===true){
     const proof=await ops.readBundleProof();
     if(s.proofCheckedAt!==null&&proof.checkedAt<s.proofCheckedAt||!equal(proof.authority,authority)||proof.sourceFingerprint!==checked.sourceFingerprint||!equal(proof.manifest,checked.manifest))fail('IMMUTABLE_DEPENDENCY_DENIED');
     s.proofCheckedAt=proof.checkedAt;bundleClockFloors.set(checked,proof.checkedAt);
     s.validatedBundle=Buffer.byteLength(JSON.stringify(checked))<=16*1024*1024?checked:null;
    }
    return checked;
   };
   const recheck=async()=>{idle();pin(tuple(await ops.recheck(authority)));};
   const selectCandidate=(b,id,options={})=>{const result=candidateAt(b,id,options);if(proofReadsEnabled===true)candidatePreviews.push({id,options:{...options}});return result;};
   const browserArchiveOps=browserArchivesEnabled===true?createBrowserArchiveCommandAuthority({query}):null;
   const tx={ops,managedOps,managedViewOps,normalizedOps,applicationOps,applicationViewOps,browserArchiveOps,verifyHistory,authority,read,recheck,selectCandidate,requireNormalized:requirement=>normalizedRequirements.push(copyJSON(requirement)),requireApplication:requirement=>applicationRequirements.push(copyJSON(requirement)),requireApplicationView:requirement=>applicationViewRequirements.push(copyJSON(requirement)),requireManagedView:requirement=>managedViewRequirements.push(copyJSON(requirement)),requireManaged:requirement=>managedRequirements.push(copyJSON(requirement)),requireAccepted:requirement=>candidateRequirements.push(copyJSON(requirement)),beforeCommit:guard=>{idle();if(finalizing||hooks.length>=1||typeof guard!=='function'){poison=true;fail('IMMUTABLE_DEPENDENCY_TRANSACTION');}hooks.push(guard);}};
   const result=await work(tx);idle();finalizing=true;for(const hook of hooks){await hook();idle();}await recheck();const finalBundle=await read();for(const requirement of candidateRequirements)checkNewAcceptance(finalBundle,requirement);
   for(const preview of candidatePreviews){
    // A pending selection consumed by this very transaction is instead checked
    // by its exact new-acceptance requirement, including the fresh TTL floor.
    if(preview.options.pending&&candidateRequirements.some(x=>x.candidate.id===preview.id))continue;
    candidateAt(finalBundle,preview.id,preview.options);
   }for(const requirement of managedRequirements){if(!managedOps||await managedOps.requireConsumed(requirement)!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');}
   for(const requirement of managedViewRequirements){if(!managedViewOps||await managedViewOps.requireConsumed(requirement)!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');}
   for(const requirement of normalizedRequirements){if(!normalizedOps||await normalizedOps.requireConsumed(requirement)!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');}
   for(const requirement of applicationViewRequirements){if(!applicationViewOps||await applicationViewOps.requireConsumed(requirement)!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');}
   for(const requirement of applicationRequirements){if(!applicationOps||await applicationOps.requireConsumed(requirement)!==true)fail('IMMUTABLE_DEPENDENCY_DENIED');}
   await ops.clear();idle();
   commitAttempted=true;if((await query('COMMIT')).command!=='COMMIT')fail('IMMUTABLE_DEPENDENCY_TRANSACTION');committed=true;closed=true;return result;
  }catch(e){closed=true;let uncertain=busy;if(owned&&started&&!committed&&!busy)try{if((await client.query('ROLLBACK',[])).command!=='ROLLBACK')uncertain=true;}catch{uncertain=true;}if(commitAttempted||uncertain)fail('IMMUTABLE_DEPENDENCY_UNCERTAIN');if(e instanceof ImmutableDependencyError)throw new ImmutableDependencyError(e.code);fail('IMMUTABLE_DEPENDENCY_DENIED');}
  finally{closed=true;if(owned)try{await client.release(committed?undefined:new Error('Discard immutable workflow lease'));leased.delete(client);}catch{fail('IMMUTABLE_DEPENDENCY_UNCERTAIN');}}
 }
 const permissionGate=Object.freeze({async authorize(credential,scope){const s=state();if(credential!==s.credential||!equal(scope,s.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');return transact(async tx=>{await tx.read();return grant(tx.authority);});}});
 const repository=Object.freeze({async transaction(context,work){const s=state();const c=copyJSON(context,8192);exact(c,['grant','scope']);if(!equal(c.scope,s.scope)||!equal(c.grant,grant(s.authority)))fail('IMMUTABLE_DEPENDENCY_DENIED');return transact(async base=>{
  const gate=Object.freeze({async authorize(token,scope){if(token!==s.credential||!equal(scope,s.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');await base.recheck();return grant(base.authority);}});
  const tx=Object.freeze({permissionGate:gate,beforeCommit:base.beforeCommit,
   async read(){const b=await base.read();if(!b.workflowRows.length)fail('IMMUTABLE_DEPENDENCY_DENIED');return b.workflowRows.at(-1).record;},
   async readCandidate(id){return freeze(base.selectCandidate(await base.read(),id,{pending:true}));},
   async readNormalizedCandidate(candidateId){if(!base.normalizedOps)fail('IMMUTABLE_DEPENDENCY_DISABLED');return base.normalizedOps.readCandidate({candidateId});},
   async readApplicationViewCandidate(candidateId){if(!base.applicationViewOps)fail('IMMUTABLE_DEPENDENCY_DISABLED');return base.applicationViewOps.readCandidate({candidateId});},
   async readApplicationCandidate(candidateId){if(!base.applicationOps)fail('IMMUTABLE_DEPENDENCY_DISABLED');return base.applicationOps.readCandidate({candidateId});},
   async readManagedViewCandidate(candidateId){if(!base.managedViewOps)fail('IMMUTABLE_DEPENDENCY_DISABLED');return base.managedViewOps.readCandidate({candidateId});},
   async readManagedCandidate(candidateId){if(!base.managedOps)fail('IMMUTABLE_DEPENDENCY_DISABLED');return base.managedOps.readCandidate({candidateId});},
   async findReceipt(key){const b=await base.read(),r=b.workflowReceipts.find(r=>r.request_key===key);if(!r)return null;const author=b.operationAuthors.find(x=>x.revision===r.receipt.appliedRevision);if(!author||!equal(tuple(author.authority),base.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');return r.receipt;},
   async write(input){const v=copyJSON(input);exact(v,['expectedRevision','record','receiptKey','receipt']);assertImmutableDependencyIntent(v.receipt?.request?.intent);const b=await base.read(),old=b.workflowRows.at(-1)?.record;if(!old||old.revision!==v.expectedRevision)return false;const next=validatePreparedWorkflowRecord(v.record,s.scope),intent=v.receipt.request.intent,refs=intent.type==='attach_media'?mediaRefs(b,intent.mediaIds):null,candidate=intent.type==='accept_model_candidate'?base.selectCandidate(b,intent.candidateId,{pending:true}):intent.type==='accept_managed_candidate'&&base.managedOps?await base.managedOps.readCandidate({candidateId:intent.candidateId}):intent.type==='accept_managed_view_candidate'&&base.managedViewOps?await base.managedViewOps.readCandidate({candidateId:intent.candidateId}):intent.type==='accept_normalized_candidate'&&base.normalizedOps?await base.normalizedOps.readCandidate({candidateId:intent.candidateId}):intent.type==='accept_application_candidate'&&base.applicationOps?await base.applicationOps.readCandidate({candidateId:intent.candidateId}):intent.type==='accept_application_view_candidate'&&base.applicationViewOps?await base.applicationViewOps.readCandidate({candidateId:intent.candidateId}):null;if(!equal(applyPreparedWorkflowIntent(old,v.receipt.request,refs,candidate),next)||!equal(v.receipt.actor,base.authority.actor))fail('IMMUTABLE_DEPENDENCY_CORRUPT');receipt({request_key:v.receiptKey,receipt:v.receipt,record_sha256:hash(next)},s.scope,next.revision);const writer=intent.type==='accept_managed_candidate'?base.managedOps?.appendManaged:intent.type==='accept_managed_view_candidate'?base.managedViewOps?.appendManaged:intent.type==='accept_normalized_candidate'?base.normalizedOps?.appendManaged:intent.type==='accept_application_candidate'?base.applicationOps?.appendManaged:intent.type==='accept_application_view_candidate'?base.applicationViewOps?.appendManaged:base.ops.appendNative;if(typeof writer!=='function')fail('IMMUTABLE_DEPENDENCY_DISABLED');const written=await writer({expectedSourceFingerprint:b.sourceFingerprint,expectedRevision:v.expectedRevision,record:next,recordSha256:hash(next),receiptKey:v.receiptKey,receipt:v.receipt});if(written&&intent.type==='accept_application_view_candidate'){const accepted=next.managedImageHistory.accepted.at(-1);base.requireApplicationView({candidateId:accepted.candidate.id,acceptance:accepted.acceptance,recordSha256:hash(next)});}else if(written&&intent.type==='accept_application_candidate'){const accepted=next.managedImageHistory.accepted.at(-1);base.requireApplication({candidateId:accepted.candidate.id,acceptance:accepted.acceptance,recordSha256:hash(next)});}else if(written&&intent.type==='accept_normalized_candidate'){const accepted=next.managedImageHistory.accepted.at(-1);base.requireNormalized({candidateId:accepted.candidate.id,acceptance:accepted.acceptance,recordSha256:hash(next)});}else if(written&&intent.type==='accept_managed_view_candidate'){const accepted=next.managedImageHistory.accepted.at(-1);base.requireManagedView({candidateId:accepted.candidate.id,acceptance:accepted.acceptance,recordSha256:hash(next)});}else if(written&&intent.type==='accept_managed_candidate'){const accepted=next.managedImageHistory.accepted.at(-1);base.requireManaged({candidateId:accepted.candidate.id,acceptance:accepted.acceptance,recordSha256:hash(next)});}else if(written&&candidate){const requirement={candidate,acceptance:next.modelCandidates.at(-1).acceptance};base.requireAccepted(requirement);s.newAcceptances.push(requirement);}return written;}
  });contexts.set(tx,base);return work(tx);
 });}});
 function assertContext(input){const s=state();if(input.credential!==s.credential||!equal(input.scope,s.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');return s;}
 function txGate(base){return Object.freeze({async authorize(token,scope){const s=state();if(token!==s.credential||!equal(scope,s.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');await base.recheck();return grant(base.authority);}});}
 async function mediaTransaction(binding,work,forUpload=false){const s=state();exact(binding,['owner','store','scope']);if(!equal(binding,{owner:s.authority?.actor.username,store:s.authority?.actor.store,scope:s.scope}))fail('IMMUTABLE_DEPENDENCY_DENIED');return transact(async base=>{
  const readRecord=async id=>{if(typeof id!=='string')fail('IMMUTABLE_DEPENDENCY_INVALID');const b=await base.read(),row=b.mediaRows.find(x=>x.media_id===id&&x.binding_key===hash(binding));if(row&&forUpload){const author=b.dependencyAuthors.find(x=>x.kind==='media'&&x.id===row.binding_key+':'+row.media_id);if(!author||!equal(author.authority,base.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');}return row?freeze({...row.record,active:row.active}):null;};
  const tx=Object.freeze({permissionGate:txGate(base),readRecord,beforeCommit:base.beforeCommit,
   async insertImmutable(input){const record=checkedMedia(copyJSON(input,8192));if(!equal(record.binding,binding))fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await base.read();if(b.mediaRows.some(x=>x.media_id===record.mediaId&&x.binding_key===hash(binding)))return false;return base.ops.insertMedia({expectedSourceFingerprint:b.sourceFingerprint,record,recordSha256:hash(record)});}
  });contexts.set(tx,base);return work(tx);
 });}
 function createMediaMetadataRepository({forUpload=false}={}){return Object.freeze({withScopeLock:(binding,work)=>mediaTransaction(binding,work,forUpload),async verifyRecords(binding,records){if(!Array.isArray(records)||records.length>300)fail('IMMUTABLE_DEPENDENCY_INVALID');const fixed=copyJSON(records);return mediaTransaction(binding,async tx=>{for(const r of fixed){checkedMedia(r);if(!equal(await tx.readRecord(r.mediaId),r))return false;}return true;},forUpload);}});}
 const mediaMetadataRepository=createMediaMetadataRepository();
 const mediaResolver=async input=>{assertContext(input);const base=contexts.get(input.transaction);if(!base||!equal(input.grant,grant(base.authority)))fail('IMMUTABLE_DEPENDENCY_DENIED');await base.recheck();const refs=mediaRefs(await base.read(),input.mediaIds);await base.recheck();return freeze(refs);};
 const mediaVerifier=async input=>{assertContext(input);return transact(async base=>freeze(mediaRefs(await base.read(),input.mediaIds)));};
 async function verifyMediaApproval(verifier,receipt,intent,phase,context){if(typeof verifier?.verifyImmutable!=='function')return false;const s=state(),base=context?.transaction?contexts.get(context.transaction):null;if(context?.transaction&&!base)fail('IMMUTABLE_DEPENDENCY_DENIED');if(base)await base.recheck();else await permissionGate.authorize(s.credential,s.scope);const authority=tuple(s.authority),fixed=copyJSON({receipt,intent,phase},65536);const accepted=await verifier.verifyImmutable(Object.freeze({...fixed,authority,transaction:context?.transaction??null}));if(base)await base.recheck();else await permissionGate.authorize(s.credential,s.scope);return accepted===true;}
 function checkFullContext(context){const s=state();exact(context,['scope','actor']);if(!equal(context.scope,s.scope)||!equal(context.actor,s.authority?.actor))fail('IMMUTABLE_DEPENDENCY_DENIED');}
 const fullArchiveTransaction=async(context,work)=>{checkFullContext(context);return transact(async base=>{
  const read=()=>base.read();const source=async snapshot=>{validateFullWorkflowSnapshot(snapshot);const b=await read();if(!equal(snapshotOf(currentRecord(b)),snapshot))throw new FullWorkflowArchiveError('FULL_SOURCE_SNAPSHOT_DENIED');verifyStoredPhotos(b,snapshot.photoRefs);if(snapshot.managedImageHistory)await base.verifyHistory(snapshot.managedImageHistory);return b;};
  const tx=Object.freeze({permissionGate:txGate(base),beforeCommit:base.beforeCommit,
   async verifyBindings({grant:g,scope,bindings}){const b=await read(),r=currentRecord(b);if(!equal(g,grant(base.authority))||!equal(scope,base.authority.scope)||!equal(bindings,{uiScope:null,evidenceScope:r.session.scope}))fail('IMMUTABLE_DEPENDENCY_DENIED');return freeze({scope,store:base.authority.actor.store,...bindings,revision:base.authority.bindingRevision});},
   async verifyPhotoRefs({grant:g,scope,photoRefs}){if(!equal(g,grant(base.authority))||!equal(scope,base.authority.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');return verifyStoredPhotos(await read(),photoRefs);},
   async verifyManagedImageHistory({grant:g,scope,managedImageHistory}){if(!equal(g,grant(base.authority))||!equal(scope,base.authority.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await read();if(!equal(currentRecord(b).managedImageHistory,managedImageHistory))fail('IMMUTABLE_DEPENDENCY_DENIED');verifyManagedWorkflowBindings(b,currentRecord(b));return base.verifyHistory(managedImageHistory);},
   async verifySourceSnapshots({grant:g,snapshot}){if(!equal(g,grant(base.authority)))fail('IMMUTABLE_DEPENDENCY_DENIED');await source(snapshot);return true;},
   async readVersions(){return (await read()).fullRows.map(x=>x.record);},
   async findReceipt({requestKey}){const b=await read(),r=b.fullReceipts.find(x=>x.request_key===requestKey)?.receipt??null;if(r){const x=b.dependencyAuthors.find(x=>x.kind==='full'&&x.id===String(r.version));if(!x||!equal(x.authority,base.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');}return r;},
   async appendVersion(input){const v=copyJSON(input);exact(v,['version','receipt','expectedVersion','expectedParentDigest']);const b=await source(v.version.snapshot),head=b.fullRows.at(-1)?.record;if((head?.version??0)!==v.expectedVersion||(head?.sha256??null)!==v.expectedParentDigest)return false;validateFullWorkflowChain([...b.fullRows.map(x=>x.record),v.version],base.authority.scope);if(!equal(v.version.actor,base.authority.actor))fail('IMMUTABLE_DEPENDENCY_DENIED');return base.ops.appendFull({expectedSourceFingerprint:b.sourceFingerprint,...v});}
  });return work(tx);
 });};
 async function loadFullArchive(input){assertContext(input);const result=await transact(async base=>{const b=await base.read();for(const v of b.fullRows)verifyStoredPhotos(b,v.record.snapshot.photoRefs);return b.fullRows.map(x=>x.record);});await transact(async base=>{const b=await base.read();if(!equal(b.fullRows.map(x=>x.record),result))fail('IMMUTABLE_DEPENDENCY_CHANGED');for(const v of result)verifyStoredPhotos(b,v.snapshot.photoRefs);});const head=result.at(-1);return freeze({currentVersion:head?.version??0,currentDigest:head?.sha256??null,versions:result});}
 // Browser submits only an immutable source selector, never a full snapshot.
 // A separate durable command binding disambiguates equal snapshots/revisions.
 // Historical source access is allowed ONLY for a proven exact committed replay.
 async function appendBrowserArchive(input){
  if(browserArchivesEnabled!==true)fail('IMMUTABLE_DEPENDENCY_DISABLED');
  const q=copyJSON(input,8192);exact(q,['credential','scope','requestId','expectedVersion','expectedParentDigest','sourceRevision','sourceDigest']);assertContext(q);
  if(typeof q.requestId!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(q.requestId)||!Number.isSafeInteger(q.sourceRevision)||q.sourceRevision<0||!SHA.test(q.sourceDigest)||!Number.isSafeInteger(q.expectedVersion)||q.expectedVersion<0||(q.expectedVersion===0?q.expectedParentDigest!==null:!SHA.test(q.expectedParentDigest)))fail('IMMUTABLE_DEPENDENCY_INVALID');
  // Pure source derivation only, scoped to this append. Every source row still
  // comes from a fresh base.read() and all live SQL/authority/history checks run.
  // An immutable row identity may reuse its privately validated snapshot handle;
  // no caller digest, permission, expiry, source proof or SQL result is cached here.
  const sourceSnapshots=new WeakMap();
  const sourceSnapshot=record=>{let handle=sourceSnapshots.get(record);if(!handle){handle=derivedSnapshots.validate(record,q.scope);sourceSnapshots.set(record,handle);}return handle.snapshot();};
  // Source preparation is read-only. It is NOT an authorization lease: the
  // actual service-owned transaction below re-reads every identity/source/command.
  const preparedSnapshot=await transact(async base=>{
   const cap=base.browserArchiveOps;if(!cap)fail('IMMUTABLE_DEPENDENCY_DISABLED');
   const prior=await cap.read(base.authority,q.requestId),b=await base.read(),row=b.workflowRows[q.sourceRevision];
   if(!row||row.revision!==q.sourceRevision||row.sha256!==q.sourceDigest||hash(row.record)!==q.sourceDigest||prior===null&&!equal(row.record,currentRecord(b)))fail('IMMUTABLE_DEPENDENCY_CHANGED');
   if(prior===null){const head=b.fullRows.at(-1)?.record;if((head?.version??0)!==q.expectedVersion||(head?.sha256??null)!==q.expectedParentDigest)fail('IMMUTABLE_DEPENDENCY_CHANGED');}
   return sourceSnapshot(row.record);
  });
  // The original archive service must own the REAL transaction completion,
  // not a nested callback that returns before its registered commit guard.
  const inner=createPreparedFullWorkflowArchive({enabled:true,permissionGate,transaction:async(context,work)=>{checkFullContext(context);return transact(async base=>{
   const cap=base.browserArchiveOps;if(!cap)fail('IMMUTABLE_DEPENDENCY_DISABLED');
   const original=await cap.read(base.authority,q.requestId),replay=original!==null;
   const commandBase={schemaVersion:'design-browser-archive-command-v1',authority:base.authority,requestKey:hash([base.authority.actor,q.requestId]),requestId:q.requestId,sourceRevision:q.sourceRevision,sourceDigest:q.sourceDigest,expectedVersion:q.expectedVersion,expectedParentDigest:q.expectedParentDigest};
   let expectedPacket=original,expectedSnapshot;
   const sourceRecord=b=>{const row=b.workflowRows[q.sourceRevision];if(!row||row.revision!==q.sourceRevision||row.sha256!==q.sourceDigest||hash(row.record)!==q.sourceDigest||!replay&&!equal(row.record,currentRecord(b)))fail('IMMUTABLE_DEPENDENCY_CHANGED');return row.record;};
   function verifyPacket(packet){
    exact(packet,['command','version','receipt']);const {command,version,receipt}=packet;exact(command,[...Object.keys(commandBase),'resultVersion','resultSha256']);
    if(!equal(command,{...commandBase,resultVersion:version.version,resultSha256:version.sha256})||version.version!==q.expectedVersion+1||(version.previous?.sha256??null)!==q.expectedParentDigest||version.requestId!==q.requestId||!equal(version.actor,base.authority.actor)||!equal(version.scope,q.scope)||!equal(version.snapshot,expectedSnapshot)||receipt.requestKey!==commandBase.requestKey||receipt.version!==version.version||receipt.sha256!==version.sha256)fail('IMMUTABLE_DEPENDENCY_DENIED');
   }
   const initial=await base.read();expectedSnapshot=sourceSnapshot(sourceRecord(initial));if(!equal(expectedSnapshot,preparedSnapshot))fail('IMMUTABLE_DEPENDENCY_CHANGED');
   if(replay)verifyPacket(original);
   else if(initial.fullReceipts.some(r=>r.request_key===commandBase.requestKey))fail('IMMUTABLE_DEPENDENCY_DENIED'); // Never adopt an old/raw API receipt.
   const source=async snapshot=>{validateFullWorkflowSnapshot(snapshot);const b=await base.read(),r=sourceRecord(b);if(!equal(sourceSnapshot(r),snapshot)||!equal(snapshot,expectedSnapshot))fail('IMMUTABLE_DEPENDENCY_CHANGED');verifyStoredPhotos(b,snapshot.photoRefs);verifyManagedWorkflowBindings(b,r);if(snapshot.managedImageHistory)await base.verifyHistory(snapshot.managedImageHistory);return b;};
   const gate=txGate(base);
   const tx=Object.freeze({permissionGate:gate,
    beforeCommit:guard=>base.beforeCommit(async()=>{await guard();const fresh=await cap.read(base.authority,q.requestId);if(!fresh||!expectedPacket||!equal(fresh,expectedPacket))fail('IMMUTABLE_DEPENDENCY_CHANGED');verifyPacket(fresh);}),
    async verifyBindings({grant:g,scope,bindings}){const b=await base.read(),r=sourceRecord(b);if(!equal(g,grant(base.authority))||!equal(scope,q.scope)||!equal(bindings,{uiScope:null,evidenceScope:r.session.scope}))fail('IMMUTABLE_DEPENDENCY_DENIED');return freeze({scope,store:base.authority.actor.store,...bindings,revision:base.authority.bindingRevision});},
    async verifyPhotoRefs({grant:g,scope,photoRefs}){if(!equal(g,grant(base.authority))||!equal(scope,q.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');return verifyStoredPhotos(await base.read(),photoRefs);},
    async verifySourceSnapshots({grant:g,snapshot}){if(!equal(g,grant(base.authority)))fail('IMMUTABLE_DEPENDENCY_DENIED');await source(snapshot);return true;},
    async verifyManagedImageHistory({grant:g,scope,managedImageHistory}){if(!equal(g,grant(base.authority))||!equal(scope,q.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await source(expectedSnapshot);if(!equal(sourceRecord(b).managedImageHistory,managedImageHistory))fail('IMMUTABLE_DEPENDENCY_DENIED');return base.verifyHistory(managedImageHistory);},
    async readVersions(){return (await base.read()).fullRows.map(r=>r.record);},
    async findReceipt({requestKey}){const b=await base.read(),r=b.fullReceipts.find(x=>x.request_key===requestKey)?.receipt??null;if(r){const author=b.dependencyAuthors.find(x=>x.kind==='full'&&x.id===String(r.version));if(!author||!equal(author.authority,base.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');}return r;},
    async appendVersion(value){if(replay)fail('IMMUTABLE_DEPENDENCY_DENIED');const v=copyJSON(value);exact(v,['version','receipt','expectedVersion','expectedParentDigest']);if(v.expectedVersion!==q.expectedVersion||v.expectedParentDigest!==q.expectedParentDigest)fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await source(v.version.snapshot),head=b.fullRows.at(-1)?.record;if((head?.version??0)!==q.expectedVersion||(head?.sha256??null)!==q.expectedParentDigest)return false;const command={...commandBase,resultVersion:v.version.version,resultSha256:v.version.sha256};expectedPacket={command,version:v.version,receipt:v.receipt};verifyPacket(expectedPacket);return cap.append(base.authority,{command,expectedSourceFingerprint:b.sourceFingerprint,version:v.version,receipt:v.receipt});}
   });
   return work(tx);
  });}});
  const result=await inner.append({credential:q.credential,scope:q.scope,requestId:q.requestId,expectedVersion:q.expectedVersion,expectedParentDigest:q.expectedParentDigest,snapshot:preparedSnapshot});
  try{const latest=await loadFullArchive({credential:q.credential,scope:q.scope});if(!equal(latest.versions[result.appliedVersion-1],result.version))fail('IMMUTABLE_DEPENDENCY_CHANGED');return freeze({...result,sourceRevision:q.sourceRevision,sourceDigest:q.sourceDigest});}catch{throw new FullWorkflowArchiveError('FULL_OUTCOME_UNCERTAIN');}
 }
 function createFullWorkflowArchive({enabled:active=false}={}){const inner=createPreparedFullWorkflowArchive({enabled:active,permissionGate,transaction:fullArchiveTransaction});return Object.freeze({async append(input){assertContext(input);const result=await inner.append(input);try{const latest=await loadFullArchive({credential:input.credential,scope:input.scope});if(!equal(latest.versions[result.appliedVersion-1],result.version))fail('IMMUTABLE_DEPENDENCY_CHANGED');return result;}catch{throw new FullWorkflowArchiveError('FULL_OUTCOME_UNCERTAIN');}},load:loadFullArchive});}
 function createCandidateRepository({ttlMs}={}){const ready=()=>{if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)fail('IMMUTABLE_DEPENDENCY_INVALID');};async function load(input){assertContext(input);ready();const first=await transact(async base=>base.selectCandidate(await base.read(),input.candidateId));const last=await transact(async base=>base.selectCandidate(await base.read(),input.candidateId));if(!equal(first,last))fail('IMMUTABLE_DEPENDENCY_CHANGED');return freeze({candidate:last});}
 return Object.freeze({load,async publish(input){assertContext(input);ready();const candidate=copyJSON(input.candidate,524288);const result=await transact(async base=>{const b=await base.read(),r=currentRecord(b),found=b.candidateRows.find(x=>x.candidate_id===candidate.id);if(!equal(candidate.actor,base.authority.actor)||!equal(candidate.scope,base.authority.scope))fail('IMMUTABLE_DEPENDENCY_DENIED');
  if(found){const author=b.dependencyAuthors.find(x=>x.kind==='candidate'&&x.id===candidate.id);if(!author||!equal(author.authority,base.authority)||!equal(base.selectCandidate(b,candidate.id),candidate))fail('IMMUTABLE_DEPENDENCY_DENIED');return {candidate,replayed:true};}
  validateDesignCandidate(candidate,r.session);validateSynthesisEvidence({candidate,session:r.session,modelCandidates:r.modelCandidates||[]});checkCandidateMedia(b,candidate,r);checkAncestors(b,candidate,r);
  if(await base.ops.publishCandidate({expectedSourceFingerprint:b.sourceFingerprint,candidate,candidateSha256:hash(candidate),ttlMs})!==true)fail('IMMUTABLE_DEPENDENCY_CHANGED');base.beforeCommit(async()=>{base.selectCandidate(await base.read(),candidate.id,{pending:true});});return {candidate,replayed:false};
 });try{const latest=await load({credential:input.credential,scope:input.scope,candidateId:candidate.id});if(!equal(latest.candidate,candidate))fail('IMMUTABLE_DEPENDENCY_CHANGED');return freeze(result);}catch{fail('IMMUTABLE_DEPENDENCY_UNCERTAIN');}}
 });}
 function createManagedCandidateRepository({views=false,normalized=false,application=false,applicationViews=false}={}){
  if([views,normalized,application,applicationViews].filter(Boolean).length>1)fail('IMMUTABLE_DEPENDENCY_INVALID');
  return Object.freeze({
   async publish(input){assertContext(input);return transact(async base=>{const selected=applicationViews?base.applicationViewOps:application?base.applicationOps:normalized?base.normalizedOps:views?base.managedViewOps:base.managedOps;if(!selected)fail('IMMUTABLE_DEPENDENCY_DISABLED');const value=await selected.publish({requestId:input.requestId});if(applicationViews){base.beforeCommit(async()=>{if(!equal(value,await selected.readCandidate({candidateId:value.candidate.id})))fail('IMMUTABLE_DEPENDENCY_CHANGED');});}else await selected.readCandidate({candidateId:value.candidate.id});return freeze(value);});},
   async load(input){assertContext(input);return transact(async base=>{const selected=applicationViews?base.applicationViewOps:application?base.applicationOps:normalized?base.normalizedOps:views?base.managedViewOps:base.managedOps;if(!selected)fail('IMMUTABLE_DEPENDENCY_DISABLED');const value=await selected.readCandidate({candidateId:input.candidateId});base.beforeCommit(async()=>{if(!equal(value,await selected.readCandidate({candidateId:input.candidateId})))fail('IMMUTABLE_DEPENDENCY_CHANGED');});return freeze(value);});}
  });
 }
 const verifyCandidateMedia=async input=>{assertContext(input);return transact(async base=>{if(!equal(input.actor,base.authority.actor))fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await base.read(),r=currentRecord(b);for(const ref of input.sourceRefs){const row=b.mediaRows.find(m=>m.media_id===ref.mediaId&&m.record.binding.owner===base.authority.actor.username),p=r.photoRefs.find(x=>x.kind==='private_media'&&x.reference.mediaId===ref.mediaId);if(!row?.active||!p||row.record.sha256!==ref.sourceSha256||!equal(p.reference,mediaReference(row.record)))fail('IMMUTABLE_DEPENDENCY_DENIED');}return true;});};
 async function synthesis(input,acceptance=false){assertContext(input);for(let i=0;i<2;i++)await transact(async base=>{if(!equal(input.actor,base.authority.actor))fail('IMMUTABLE_DEPENDENCY_DENIED');const b=await base.read(),r=currentRecord(b);let candidate;if(Object.hasOwn(input,'candidateId')){candidate=base.selectCandidate(b,input.candidateId,{ancestors:acceptance});if(candidate.kind!=='completion_synthesis')fail('IMMUTABLE_DEPENDENCY_DENIED');if(acceptance){if(!b.candidateRows.find(x=>x.candidate_id===candidate.id)?.consumed)fail('IMMUTABLE_DEPENDENCY_DENIED');}else if(!equal(Object.fromEntries(['sessionId','baseRevision','inputDigest','synthesis','sourceRefs'].map(k=>[k,input[k]])),Object.fromEntries(['sessionId','baseRevision','inputDigest','synthesis','sourceRefs'].map(k=>[k,candidate[k]]))))fail('IMMUTABLE_DEPENDENCY_DENIED');}
 else{if(r.session.scope.sessionId!==input.sessionId||r.session.revision!==input.baseRevision||hash(r.session)!==input.inputDigest)fail('IMMUTABLE_DEPENDENCY_CHANGED');validateSynthesisContext({session:r.session,modelCandidates:r.modelCandidates||[],synthesis:input.synthesis,sourceRefs:input.sourceRefs});candidate={kind:'completion_synthesis',synthesis:input.synthesis,sourceRefs:input.sourceRefs};checkAncestors(b,candidate,r);}return true;});return true;}
 async function prepareGeneration(input){
  const fixed=copyJSON(input,8192);exact(fixed,['credential','scope','requestId','kind']);assertContext(fixed);
  const kinds=['text_extraction','visual_description','completion_comparison','completion_synthesis','speech'];
  if(typeof fixed.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(fixed.requestId)||!kinds.includes(fixed.kind))fail('IMMUTABLE_DEPENDENCY_INVALID');
  return transact(async base=>{
   const b=await base.read(),record=currentRecord(b);verifyStoredPhotos(b,record.photoRefs);
   if(fixed.kind==='visual_description'&&(record.session.phase!=='before_analysis'||!record.photoRefs.some(p=>p.kind==='private_media')))fail('IMMUTABLE_DEPENDENCY_DENIED');
   if(['completion_comparison','completion_synthesis'].includes(fixed.kind)&&record.session.phase!=='completed_review')fail('IMMUTABLE_DEPENDENCY_DENIED');
   if(fixed.kind!=='speech'){
    const candidateId=hash([base.authority.actor,fixed.requestId,fixed.kind]),row=b.candidateRows.find(x=>x.candidate_id===candidateId);
    if(row){const author=b.dependencyAuthors.find(x=>x.kind==='candidate'&&x.id===candidateId);if(!author||!equal(author.authority,base.authority))fail('IMMUTABLE_DEPENDENCY_DENIED');base.selectCandidate(b,candidateId);}
   }
   return freeze({authority:base.authority,record});
  });
 }

 return Object.freeze({permissionGate,repository,prepareGeneration,resolveAuthority:()=>transact(async base=>{await base.read();return base.authority;}),mediaMetadataRepository,createMediaMetadataRepository,verifyMediaApproval,mediaResolver,mediaVerifier,fullArchiveTransaction,loadFullArchive,createFullWorkflowArchive,appendBrowserArchive,createCandidateRepository,createManagedCandidateRepository,verifyCandidateMedia,verifySynthesisAncestors:input=>synthesis(input),verifySynthesisAcceptance:input=>synthesis(input,true),
  async runRequest(request,work){if(enabled!==true)fail('IMMUTABLE_DEPENDENCY_DISABLED');const r=copyJSON(request,8192);exact(r,['credential','scope']);if(typeof r.credential!=='string'||r.credential.length<32||r.credential.length>200||/\s/.test(r.credential)||typeof work!=='function'||local.getStore())fail('IMMUTABLE_DEPENDENCY_INVALID');r.scope=validateProductionDesignScope(r.scope);const s={...r,authority:null,closed:false,newAcceptances:[],validatedBundle:null,proofCheckedAt:null};try{return await withFullWorkflowSnapshotValidation(()=>derivedSnapshots.run(()=>local.run(s,async()=>{const result=await work();if(s.newAcceptances.length){try{await transact(async base=>{const b=await base.read();for(const requirement of s.newAcceptances){checkNewAcceptance(b,requirement);if(proofReadsEnabled===true)base.requireAccepted(requirement);}});}catch{fail('IMMUTABLE_DEPENDENCY_UNCERTAIN');}}return result;})));}finally{s.closed=true;s.validatedBundle=null;s.proofCheckedAt=null;}},
  async initialize(){return transact(async tx=>{const b=await tx.read();if(b.workflowRows.length)return b.workflowRows.at(-1).record;const record=validatePreparedWorkflowRecord({schemaVersion:PREPARED_RECORD_SCHEMA,revision:0,scope:tx.authority.scope,store:tx.authority.actor.store,session:createDesignSession({customerId:tx.authority.scope.customerProfileId,visitId:tx.authority.scope.visitId,sessionId:'prepared-'+randomUUID()}),archives:[],legacyVersions:b.legacyVersions,photoRefs:b.legacyPhotos},tx.authority.scope);if(await tx.ops.initializeNative({expectedSourceFingerprint:b.sourceFingerprint,record,recordSha256:hash(record)})!==true)fail('IMMUTABLE_DEPENDENCY_CHANGED');return record;});}
 });
}
