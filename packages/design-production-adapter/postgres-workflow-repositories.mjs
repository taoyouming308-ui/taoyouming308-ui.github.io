/** Same-connection repositories. No connection creation, credentials, SQL installation or default activation. */
import {createHash,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createProductionEmployeeAdapter,validateProductionDesignScope} from './employee-adapter.mjs';
import {createVisitScopeResolver} from './visit-scope-resolver.mjs';
import {createVisitListService} from './visit-list-service.mjs';
import {createDesignSession} from '../analysis-engine/design-pilot.mjs';
import {validateDesignCandidate,validateSynthesisEvidence,validateSynthesisContext} from '../analysis-engine/design-candidate.mjs';
import {reconstructCandidateSessionPrefix,validateDesignCandidatePhotoRefs} from '../analysis-engine/design-candidate-history.mjs';
import {PREPARED_RECORD_SCHEMA,validatePreparedWorkflowRecord,applyPreparedWorkflowIntent,replayPreparedWorkflowIntentAgainstValidated,PreparedWorkflowError} from './prepared-workflow-service.mjs';
import {createFullWorkflowSnapshot,createPreparedFullWorkflowArchive,validateFullWorkflowChain,validateFullWorkflowSnapshot,FullWorkflowArchiveError} from './full-workflow-archive.mjs';
export const WORKFLOW_POSTGRES_CONTRACT='design-workflow-postgres-v1';
export class PostgresWorkflowError extends Error{constructor(code){super(code);this.name='PostgresWorkflowError';this.code=code;this.retryable=false;if(code==='PG_CANDIDATE_OUTCOME_UNCERTAIN')this.outcome='uncertain';}}
const fail=code=>{throw new PostgresWorkflowError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('PG_WORKFLOW_INVALID');};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const copy=v=>JSON.parse(canonical(v));
const equal=(a,b)=>canonical(a)===canonical(b);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const text=(v,max=160)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const ident=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const MAX_HISTORY_BYTES=64*1024*1024;
const snapshotOf=record=>createFullWorkflowSnapshot({scope:record.scope,store:record.store,bindings:{uiScope:null,evidenceScope:record.session.scope},ui:null,evidence:{session:record.session,archives:record.archives},legacyVersions:record.legacyVersions,photoRefs:record.photoRefs,...(record.modelCandidates?{modelCandidates:record.modelCandidates}:{})});
function actor(v){exact(v,['username','store']);if(!text(v.username,80)||!['自由手艺人','向里造型'].includes(v.store))fail('PG_WORKFLOW_SCOPE_DENIED');return freeze(copy(v));}
function grant(v,scope){exact(v,['actor','scope']);actor(v.actor);if(!equal(v.scope,scope))fail('PG_WORKFLOW_SCOPE_DENIED');return freeze(copy(v));}
function mediaBinding(v){exact(v,['owner','store','scope']);actor({username:v.owner,store:v.store});return freeze({owner:v.owner,store:v.store,scope:validateProductionDesignScope(v.scope)});}
function mediaRecord(v){
 exact(v,['mediaId','requestId','binding','stage','angle','mime','byteLength','width','height','sha256','active']);
 if(!ident(v.mediaId)||v.requestId!==v.mediaId||!['before','after','reference'].includes(v.stage)||!['front','back','left','right','detail'].includes(v.angle)||!['image/jpeg','image/png','image/webp'].includes(v.mime)||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||v.byteLength>8*1024*1024||!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||v.width<1||v.height<1||v.width>16384||v.height>16384||v.width*v.height>40000000||!SHA.test(v.sha256)||v.active!==true)fail('PG_MEDIA_INVALID');
 return freeze({...copy(v),binding:mediaBinding(v.binding)});
}
const reference=r=>freeze(Object.fromEntries(['mediaId','stage','angle','mime','byteLength','width','height'].map(k=>[k,r[k]])));
const CONTEXTS=new WeakMap();
/** Internal fixed-SQL capabilities. Only the executor supplies these dependencies. */
export function createPostgresWorkflowOperations({base,rows,one,needWrite,markWrite,usable,dbNow,deadline}){
 let contractChecked=false;
 async function contract(){usable();if(!contractChecked){const r=await one('SELECT version FROM design_private.workflow_contract WHERE id=true FOR SHARE');if(r.version!==WORKFLOW_POSTGRES_CONTRACT)fail('PG_WORKFLOW_NOT_INSTALLED');contractChecked=true;}}
 const employee=createProductionEmployeeAdapter(base);
 async function authorize(credential,scope,expected){const found=grant(await employee.gate.authorize(credential,scope),scope);if(expected&&!equal(found,expected))fail('PG_WORKFLOW_SCOPE_DENIED');return found;}
 function scoped(scope,expected){
  scope=validateProductionDesignScope(scope);if(expected)grant(expected,scope);let current=null,credential;
  const gate=Object.freeze({async authorize(token,input){if(!equal(validateProductionDesignScope(input),scope))fail('PG_WORKFLOW_SCOPE_DENIED');const got=await authorize(token,scope,expected);if(current&&!equal(current,got))fail('PG_WORKFLOW_SCOPE_DENIED');current=got;credential=token;return got;}});
  const authorized=()=>{usable();if(!current)fail('PG_WORKFLOW_AUTH_REQUIRED');return current;};
  const recheck=()=>authorize(credential,scope,authorized());
  return {scope,gate,authorized,recheck,get credential(){return credential;}};
 }
 async function bounded(sql,params,max){const raw=await one(sql,params),r={count:raw.count,bytes:Number(raw.bytes_text)};if(!Number.isSafeInteger(r.count)||r.count<0||r.count>max||!Number.isSafeInteger(r.bytes)||r.bytes<0||r.bytes>MAX_HISTORY_BYTES)fail('PG_WORKFLOW_CAPACITY');return r;}
 async function history(scope){
  await contract();const key=digest(scope);
  await bounded('SELECT count(*)::integer AS count,coalesce(sum(octet_length(record::text)),0)::bigint::text AS bytes_text FROM design_private.workflow_versions WHERE scope_key=$1',[key],1001);
  const found=await rows('SELECT revision,record,sha256,previous_sha256,receipt_key FROM design_private.workflow_versions WHERE scope_key=$1 ORDER BY revision LIMIT 1002 FOR SHARE',[key],1002);
  let prior=null;const result=[];
  for(const row of found){
   exact(row,['revision','record','sha256','previous_sha256','receipt_key']);const r=validatePreparedWorkflowRecord(row.record,scope);
   if(row.revision!==result.length||r.revision!==row.revision||row.sha256!==digest(r)||row.previous_sha256!==(prior?digest(prior):null))fail('PG_WORKFLOW_CORRUPT');
   if(!prior){if(row.receipt_key!==null||r.schemaVersion!==PREPARED_RECORD_SCHEMA||r.session.revision!==0||r.archives.length||r.photoRefs.some(p=>p.kind!=='legacy_asset'))fail('PG_WORKFLOW_CORRUPT');}
   else{
    if(!SHA.test(row.receipt_key))fail('PG_WORKFLOW_CORRUPT');
    const receipt=await receiptAt(row.receipt_key),p=receipt?.receipt;
    if(!p||receipt.record_sha256!==row.sha256)fail('PG_WORKFLOW_CORRUPT');checkReceipt(p,row.receipt_key,scope,r.revision);
    const refs=p.request.intent.type==='attach_media'?r.photoRefs.slice(prior.photoRefs.length).map(p=>p.reference):null;
    const accepted=p.request.intent.type==='accept_model_candidate'?r.modelCandidates?.at(-1):null;
    if(accepted)await verifyAcceptedCandidate(accepted,r,row.receipt_key);
    let replay;try{replay=replayPreparedWorkflowIntentAgainstValidated({prior,request:p.request,mediaReferences:refs,trustedCandidate:accepted?.candidate,expected:r});}catch{fail('PG_WORKFLOW_CORRUPT');}
    if(!equal(replay,r))fail('PG_WORKFLOW_CORRUPT');
   }
   result.push(r);prior=r;
  }
  return freeze(result);
 }
 async function receiptAt(key){if(!SHA.test(key))fail('PG_WORKFLOW_INVALID');const found=await rows('SELECT receipt,record_sha256 FROM design_private.workflow_receipts WHERE request_key=$1 FOR SHARE',[key],1);return found[0]||null;}
 function checkReceipt(r,key,scope,revision){
  exact(r,['fingerprint','scope','actor','appliedRevision','request']);actor(r.actor);exact(r.request,['requestId','expectedRevision','intent']);
  if(!equal(r.scope,scope)||r.appliedRevision!==revision||r.request.expectedRevision!==revision-1||!ident(r.request.requestId)||r.request.requestId.length>80||key!==digest([r.actor,r.request.requestId])||r.fingerprint!==digest({scope,...r.request}))fail('PG_WORKFLOW_CORRUPT');
 }
 async function legacy(scope,store){
  // Preserve existing immutable versions as their public adapter representation.
  const customer=Number(scope.customerProfileId),key=scope.assignmentSource==='appointment'?scope.visitId:null;
  const bindings=await base.resolveVisitBinding(await sourceRow(scope));if(bindings.length!==1)fail('PG_WORKFLOW_SCOPE_DENIED');
  const visitKey=bindings[0].visitKey;if(key&&key!==visitKey)fail('PG_WORKFLOW_SCOPE_DENIED');
  await bounded('SELECT count(*)::integer AS count,coalesce(sum(octet_length(to_jsonb(v)::text)),0)::bigint::text AS bytes_text FROM public.customer_design_versions v WHERE customer_profile_id=$1::bigint AND visit_key=$2',[customer,visitKey],1000);
  const result=await rows("SELECT jsonb_build_object('id',id,'requestId',request_id,'versionNumber',version_no,'previousVersionId',previous_version_id,'createdAt',created_at,'actor',jsonb_build_object('username',author,'store',store),'scope',$3::jsonb,'snapshot',jsonb_build_object('baseline',baseline,'optimized',optimized,'reasons',reasons,'execution',execution,'process',process,'review',review,'status',status,'photo_ids',to_jsonb(photo_ids),'archive_url',null)) AS record,archive_url FROM public.customer_design_versions WHERE customer_profile_id=$1::bigint AND visit_key=$2 ORDER BY version_no LIMIT 1001 FOR SHARE",[customer,visitKey,canonical(scope)],1001);
  if(result.length>1000||result.some(r=>r.archive_url!==''||r.record.actor.store!==store))fail('PG_LEGACY_IMPORT_REQUIRED');
  const versions=result.map(r=>r.record),ids=[...new Set(versions.flatMap(r=>r.snapshot.photo_ids))],photos=[];
  for(const id of ids){
   if(!UUID.test(id))fail('PG_LEGACY_IMPORT_REQUIRED');
   const found=await rows('SELECT stage,angle FROM public.customer_design_assets WHERE id=$1::uuid AND customer_profile_id=$2::bigint AND visit_key=$3 AND store=$4 FOR SHARE',[id,customer,visitKey,store],1);
   if(found.length!==1||!['before','after'].includes(found[0].stage)||!['front','back','left','right'].includes(found[0].angle))fail('PG_LEGACY_IMPORT_REQUIRED');
   photos.push({kind:'legacy_asset',assetId:id,scope,store,...found[0]});
  }
  return {versions,photos};
 }
 async function sourceRow(scope){
  const a=scope.assignmentSource==='appointment',id=scope.visitId.slice(a?8:10),r=await base.restRows(a?`bookings?select=id,barber_name,shop_name,date,status&id=eq.${id}&limit=2`:`frontdesk_today_customers?select=id,barber_name,store,business_date,status&id=eq.${id}&limit=2`);
  if(r.length!==1)fail('PG_WORKFLOW_SCOPE_DENIED');const v=r[0];return {source:scope.assignmentSource,visitId:scope.visitId,id:String(v.id),staffUsername:v.barber_name,store:a?v.shop_name:v.store,bookingDate:a?v.date:v.business_date,status:v.status};
 }
 async function checkLegacy(record,allowPrefix=false){const live=await legacy(record.scope,record.store);if(!equal(record.legacyVersions,allowPrefix?live.versions.slice(0,record.legacyVersions.length):live.versions))fail('PG_LEGACY_SOURCE_CHANGED');const wanted=record.photoRefs.filter(p=>p.kind==='legacy_asset');if(wanted.some(p=>!live.photos.some(x=>equal(x,p))))fail('PG_LEGACY_SOURCE_CHANGED');}
 async function readMedia(binding,id){
  await contract();binding=mediaBinding(binding);if(!ident(id))fail('PG_MEDIA_INVALID');const key=digest(binding);
  const found=await rows('SELECT record,record_sha256 FROM design_private.media_records WHERE binding_key=$1 AND media_id=$2 FOR SHARE',[key,id],1);if(!found.length)return null;
  const r=mediaRecord(found[0].record);if(!equal(r.binding,binding)||r.mediaId!==id||digest(r)!==found[0].record_sha256)fail('PG_MEDIA_CORRUPT');
  const access=await rows('SELECT active,revision FROM design_private.media_access WHERE binding_key=$1 AND media_id=$2 FOR SHARE',[key,id],1);
  if(access.length!==1||typeof access[0].active!=='boolean'||!Number.isSafeInteger(access[0].revision)||access[0].revision<1)fail('PG_MEDIA_CORRUPT');return freeze({...r,active:access[0].active});
 }
 async function mediaReferences(context,ids){
  const g=context.authorized();if(!Array.isArray(ids)||ids.length>300||new Set(ids).size!==ids.length||!ids.every(ident))fail('PG_MEDIA_INVALID');
  const binding={owner:g.actor.username,store:g.actor.store,scope:context.scope},result=[];
  for(const id of ids){const r=await readMedia(binding,id);if(!r||!r.active)fail('PG_MEDIA_DENIED');result.push(reference(r));}return freeze(result);
 }
 async function verifyPhotos(context,photos){
  const g=context.authorized();for(const p of photos){
   if(!equal(p.scope,context.scope)||p.store!==g.actor.store)fail('PG_MEDIA_DENIED');
   if(p.kind==='private_media'){const live=await mediaReferences(context,[p.reference.mediaId]);if(!equal(live[0],p.reference))fail('PG_MEDIA_DENIED');}
   else if(p.kind==='legacy_asset'){const live=await legacy(context.scope,g.actor.store);if(!live.photos.some(x=>equal(x,p)))fail('PG_MEDIA_DENIED');}
   else fail('PG_MEDIA_DENIED');
  }return true;
 }
 async function candidateRow(id){
  await contract();if(!ident(id)||id.length>80)fail('PG_CANDIDATE_DENIED');
  const metadata=await rows('SELECT scope_key,sha256,expires_at::text AS expires_at,octet_length(envelope::text)::integer AS bytes FROM design_private.model_candidates WHERE candidate_id=$1 FOR SHARE',[id],1);
  // PostgreSQL jsonb::text includes whitespace; the pure validator still checks
  // the stricter canonical 256 KiB limit after this bounded storage read.
  if(metadata.length!==1||!Number.isSafeInteger(metadata[0].bytes)||metadata[0].bytes<1||metadata[0].bytes>524288||!SHA.test(metadata[0].sha256))fail('PG_CANDIDATE_DENIED');
  const raw=await one('SELECT envelope FROM design_private.model_candidates WHERE candidate_id=$1 FOR SHARE',[id]);
  if(!plain(raw.envelope)||raw.envelope.id!==id||digest(raw.envelope)!==metadata[0].sha256||digest(raw.envelope.scope)!==metadata[0].scope_key)fail('PG_CANDIDATE_CORRUPT');
  const expiresAt=Date.parse(metadata[0].expires_at);if(!Number.isSafeInteger(expiresAt))fail('PG_CANDIDATE_CORRUPT');
  const access=await rows('SELECT active,revision FROM design_private.model_candidate_access WHERE candidate_id=$1 FOR SHARE',[id],1);
  if(access.length!==1||typeof access[0].active!=='boolean'||!Number.isSafeInteger(access[0].revision)||access[0].revision<1)fail('PG_CANDIDATE_CORRUPT');
  const consumed=await rows('SELECT receipt FROM design_private.model_candidate_acceptances WHERE candidate_id=$1 FOR SHARE',[id],1);
  return {candidate:raw.envelope,sha256:metadata[0].sha256,expiresAt,expiresText:metadata[0].expires_at,active:access[0].active,consumed:consumed[0]?.receipt??null};
 }
 function validateCandidateAt(candidate,record,current=false){
  if(!equal(candidate.scope,record.scope)||candidate.store!==record.store)fail('PG_CANDIDATE_DENIED');
  try{const session=current?record.session:reconstructCandidateSessionPrefix(record.session,candidate.baseRevision),checked=validateDesignCandidate(candidate,session);validateSynthesisEvidence({candidate:checked,session,modelCandidates:record.modelCandidates??[]});return checked;}catch{fail('PG_CANDIDATE_DENIED');}
 }
 async function candidateMedia(c,sourceRefs,record,candidate){
  if(candidate)try{validateDesignCandidatePhotoRefs({candidate,photoRefs:record.photoRefs,scope:record.scope,store:record.store});}catch{fail('PG_CANDIDATE_DENIED');}
  if(!Array.isArray(sourceRefs)||sourceRefs.length>30)fail('PG_CANDIDATE_DENIED');const g=c.authorized(),seen=new Set();
  for(const ref of sourceRefs){
   exact(ref,['mediaId','sourceSha256',...(Object.hasOwn(ref,'derivativeSha256')?['derivativeSha256']:[])]);if(!ident(ref.mediaId)||seen.has(ref.mediaId)||!SHA.test(ref.sourceSha256)||(Object.hasOwn(ref,'derivativeSha256')&&!SHA.test(ref.derivativeSha256)))fail('PG_CANDIDATE_DENIED');seen.add(ref.mediaId);
   const attached=record.photoRefs.find(p=>p.kind==='private_media'&&p.reference.mediaId===ref.mediaId);
   if(!attached)fail('PG_CANDIDATE_DENIED');const live=await readMedia({owner:g.actor.username,store:g.actor.store,scope:c.scope},ref.mediaId);
   if(!live?.active||live.sha256!==ref.sourceSha256||!equal(reference(live),attached.reference))fail('PG_CANDIDATE_DENIED');
  }return true;
 }
 async function activeSynthesisAncestors(c,candidate,record){
  if(candidate.kind!=='completion_synthesis')return true;
  const grant=c.authorized(),verifiedRefs=[];
  for(const evidence of candidate.synthesis.evidence){
   const row=await candidateRow(evidence.candidateId),accepted=record.modelCandidates?.find(value=>value.candidate.id===evidence.candidateId);
   if(!accepted||row.candidate.kind!=='completion_comparison'||!row.active||!row.consumed||!equal(row.candidate.actor,grant.actor)||!equal(row.candidate,accepted.candidate)||digest(row.candidate)!==evidence.candidateDigest)fail('PG_CANDIDATE_DENIED');
   // TTL no longer invalidates accepted comparison evidence. Explicit current
   // revocation does block new synthesis, while old accepted archives stay intact.
   // Reuse only the row just locked by this call, never a prior transaction's
   // authorization/access result. Receipt and full artifact checks still run.
   await verifyAcceptedCandidate(accepted,record,digest([accepted.candidate.actor,accepted.acceptance.requestId]),row);
   await candidateMedia(c,row.candidate.sourceRefs,record,row.candidate);
   verifiedRefs.push(...row.candidate.sourceRefs);
  }return verifiedRefs;
 }
 async function candidateFor(c,id,record,pending=false){
  const row=await candidateRow(id),g=c.authorized();
  if(!equal(row.candidate.actor,g.actor)||!equal(row.candidate.scope,c.scope)||!row.active||(pending&&row.consumed)||((pending||!row.consumed)&&row.expiresAt<=await dbNow()))fail('PG_CANDIDATE_DENIED');
  validateCandidateAt(row.candidate,record,pending);await candidateMedia(c,row.candidate.sourceRefs,record,row.candidate);if(pending||!row.consumed)await activeSynthesisAncestors(c,row.candidate,record);
  if(row.consumed){const accepted=record.modelCandidates?.find(item=>item.candidate.id===id);if(!accepted)fail('PG_CANDIDATE_CORRUPT');const expected={scope:record.scope,candidateId:id,candidateDigest:digest(accepted.candidate),receiptKey:digest([accepted.candidate.actor,accepted.acceptance.requestId]),acceptance:accepted.acceptance};if(!equal(row.consumed,expected)||!equal(row.candidate,accepted.candidate))fail('PG_CANDIDATE_CORRUPT');}
  if(pending)deadline(row.expiresText);return row;
 }
 async function verifyAcceptedCandidate(accepted,record,receiptKey,lockedRow){
  const row=lockedRow??await candidateRow(accepted.candidate.id);validateCandidateAt(row.candidate,record);
  const expected={scope:record.scope,candidateId:accepted.candidate.id,candidateDigest:digest(accepted.candidate),receiptKey,acceptance:accepted.acceptance};
  if(!equal(row.candidate,accepted.candidate)||!equal(row.consumed,expected))fail('PG_CANDIDATE_CORRUPT');
 }
 async function publishCandidate({credential,scope,candidate,ttlMs}){
  needWrite();scope=validateProductionDesignScope(scope);if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)fail('PG_CANDIDATE_NOT_CONFIGURED');
  const c=scoped(scope);await c.gate.authorize(credential,scope);await contract();
  const current=(await history(scope)).at(-1);if(!current)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(current);
  const g=c.authorized();if(!plain(candidate)||!ident(candidate.id)||candidate.id.length>80||!equal(candidate.actor,g.actor)||!equal(candidate.scope,scope))fail('PG_CANDIDATE_DENIED');
  const found=await rows('SELECT candidate_id FROM design_private.model_candidates WHERE candidate_id=$1 FOR SHARE',[candidate.id],1);
  if(found.length){const previous=await candidateFor(c,candidate.id,current);if(!equal(previous.candidate,candidate))fail('PG_CANDIDATE_CONFLICT');await base.beforeCommit(()=>c.recheck());return {candidate:previous.candidate,replayed:true};}
  const checked=validateCandidateAt(candidate,current,true);await candidateMedia(c,checked.sourceRefs,current,checked);await activeSynthesisAncestors(c,checked,current);
  const expiresAt=(await dbNow())+ttlMs,expiresText=new Date(expiresAt).toISOString(),sha=digest(checked);deadline(expiresText);
  const saved=await one('INSERT INTO design_private.model_candidates(candidate_id,scope_key,envelope,sha256,expires_at) VALUES($1,$2,$3::jsonb,$4,$5::timestamptz) RETURNING sha256',[checked.id,digest(scope),canonical(checked),sha,expiresText]);
  if(saved.sha256!==sha)fail('PG_CANDIDATE_CORRUPT');await one('INSERT INTO design_private.model_candidate_access(candidate_id,active,revision) VALUES($1,true,1) RETURNING active',[checked.id]);markWrite();
  await base.beforeCommit(async()=>{const latest=(await history(scope)).at(-1);if(!equal(latest,current))fail('PG_CANDIDATE_DENIED');await candidateFor(c,checked.id,latest,true);await c.recheck();});return {candidate:checked,replayed:false};
 }
 async function loadCandidate({credential,scope,candidateId,expectedActor,requireCurrent=false}){
  scope=validateProductionDesignScope(scope);const c=scoped(scope,expectedActor?{scope,actor:expectedActor}:undefined);await c.gate.authorize(credential,scope);const record=(await history(scope)).at(-1);if(!record)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(record);
  const row=await candidateFor(c,candidateId,record);if(requireCurrent)validateCandidateAt(row.candidate,record,true);await c.recheck();
  // Preview is a read-only snapshot at this final DB validation point, not an
  // acceptance grant. Only acceptance has the deferred COMMIT deadline guard.
  if(!row.consumed&&row.expiresAt<=await dbNow())fail('PG_CANDIDATE_DENIED');return {candidate:row.candidate};
 }
 async function workflow(context,work){
  exact(context,['grant','scope']);const c=scoped(context.scope,context.grant);await contract();
  const tx={permissionGate:c.gate,
   async read(){c.authorized();const h=await history(c.scope);if(!h.length)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(h.at(-1));return h.at(-1);},
   async readCandidate(id){c.authorized();const current=(await history(c.scope)).at(-1);if(!current)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(current);return freeze(copy((await candidateFor(c,id,current,true)).candidate));},
   async findReceipt(key){c.authorized();const row=await receiptAt(key);if(!row)return null;const r=row.receipt;if(!equal(r.scope,c.scope)||!equal(r.actor,c.authorized().actor))throw new PreparedWorkflowError('WORKFLOW_REQUEST_CONFLICT');return freeze(copy(r));},
   async write(input){
    needWrite();exact(input,['expectedRevision','record','receiptKey','receipt']);const g=c.authorized(),h=await history(c.scope),old=h.at(-1),r=validatePreparedWorkflowRecord(input.record,c.scope);
    if(!old||old.revision!==input.expectedRevision)return false;if(h.length>=1001)fail('PG_WORKFLOW_CAPACITY');
    checkReceipt(input.receipt,input.receiptKey,c.scope,r.revision);if(!equal(input.receipt.actor,g.actor)||r.store!==g.actor.store||r.revision!==old.revision+1)fail('PG_WORKFLOW_SCOPE_DENIED');
    const refs=input.receipt.request.intent.type==='attach_media'?r.photoRefs.slice(old.photoRefs.length).map(p=>p.reference):null;
    const accepted=input.receipt.request.intent.type==='accept_model_candidate'?r.modelCandidates?.at(-1):null;
    let candidate=null;if(accepted){candidate=(await candidateFor(c,input.receipt.request.intent.candidateId,old,true)).candidate;if(!equal(candidate,accepted.candidate))fail('PG_CANDIDATE_CORRUPT');}
    if(!equal(applyPreparedWorkflowIntent(old,input.receipt.request,refs,candidate),r))fail('PG_WORKFLOW_CORRUPT');
    await verifyPhotos(c,r.photoRefs);await checkLegacy(r);if(Buffer.byteLength(canonical([...h,r]))>MAX_HISTORY_BYTES)fail('PG_WORKFLOW_CAPACITY');
    const key=digest(c.scope),sha=digest(r),saved=await rows('INSERT INTO design_private.workflow_versions(scope_key,revision,record,sha256,previous_sha256,receipt_key) SELECT $1,$2::integer,$3::jsonb,$4,$5,$6 WHERE (SELECT max(revision) FROM design_private.workflow_versions WHERE scope_key=$1)=$7::integer RETURNING sha256',[key,r.revision,canonical(r),sha,digest(old),input.receiptKey,input.expectedRevision],1);
    if(saved.length!==1||saved[0].sha256!==sha)return false;
    const receipt=await one('INSERT INTO design_private.workflow_receipts(request_key,receipt,record_sha256) VALUES($1,$2::jsonb,$3) RETURNING record_sha256',[input.receiptKey,canonical(input.receipt),sha]);if(receipt.record_sha256!==sha)fail('PG_WORKFLOW_CORRUPT');
    if(accepted){
     const consumed={scope:c.scope,candidateId:candidate.id,candidateDigest:digest(candidate),receiptKey:input.receiptKey,acceptance:accepted.acceptance};
     const saved=await one('INSERT INTO design_private.model_candidate_acceptances(candidate_id,receipt) VALUES($1,$2::jsonb) RETURNING receipt',[candidate.id,canonical(consumed)]);if(!equal(saved.receipt,consumed))fail('PG_CANDIDATE_CORRUPT');
     await base.beforeCommit(async()=>{const row=await candidateRow(candidate.id);if(!row.active||row.expiresAt<=await dbNow()||!equal(row.candidate,candidate)||!equal(row.consumed,consumed))fail('PG_CANDIDATE_DENIED');await candidateMedia(c,candidate.sourceRefs,r,candidate);await activeSynthesisAncestors(c,candidate,r);await c.recheck();});
    }
    markWrite();return true;
   },beforeCommit:hook=>base.beforeCommit(hook)};
  CONTEXTS.set(tx,{operations:api,context:c});return work(Object.freeze(tx));
 }
 async function initialize({credential,scope}){
  needWrite();scope=validateProductionDesignScope(scope);const c=scoped(scope);await c.gate.authorize(credential,scope);await contract();
  const h=await history(scope);if(h.length){await checkLegacy(h.at(-1));await verifyPhotos(c,h.at(-1).photoRefs);await base.beforeCommit(()=>c.recheck());return h.at(-1);}
  const g=c.authorized(),old=await legacy(scope,g.actor.store),session=createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'prepared-'+randomUUID()});
  const r=validatePreparedWorkflowRecord({schemaVersion:PREPARED_RECORD_SCHEMA,revision:0,scope,store:g.actor.store,session,archives:[],photoRefs:old.photos,legacyVersions:old.versions},scope),sha=digest(r);
  const saved=await one('INSERT INTO design_private.workflow_versions(scope_key,revision,record,sha256,previous_sha256,receipt_key) VALUES($1,0,$2::jsonb,$3,NULL,NULL) RETURNING sha256',[digest(scope),canonical(r),sha]);if(saved.sha256!==sha)fail('PG_WORKFLOW_CORRUPT');markWrite();await base.beforeCommit(async()=>{await checkLegacy(r);await c.recheck();});return r;
 }
 async function fullHistory(scope){
  await contract();await bounded('SELECT count(*)::integer AS count,coalesce(sum(octet_length(record::text)),0)::bigint::text AS bytes_text FROM design_private.full_versions WHERE scope_key=$1',[digest(scope)],100);const found=await rows('SELECT version,record,sha256 FROM design_private.full_versions WHERE scope_key=$1 ORDER BY version LIMIT 101 FOR SHARE',[digest(scope)],101);
  const chain=validateFullWorkflowChain(found.map(row=>{if(row.version!==row.record?.version||row.sha256!==row.record?.sha256)fail('PG_FULL_CORRUPT');return row.record;}),scope);
  for(const v of chain){const key=digest([v.actor,v.requestId]),r=await fullReceipt(key),expected={requestKey:key,fingerprint:digest({actor:v.actor,scope,requestId:v.requestId,expectedVersion:v.version-1,expectedParentDigest:v.previous?.sha256??null,snapshotSha256:v.snapshot.sha256}),scope,version:v.version,sha256:v.sha256};if(!equal(r,expected))fail('PG_FULL_CORRUPT');}return chain;
 }
 async function fullReceipt(key){if(!SHA.test(key))fail('PG_WORKFLOW_INVALID');const found=await rows('SELECT receipt FROM design_private.full_receipts WHERE request_key=$1 FOR SHARE',[key],1);return found[0]?.receipt??null;}
 async function sourceSnapshot(scope,snapshot,latest=false){const checked=validateFullWorkflowSnapshot(snapshot),h=await history(scope),choices=latest?h.slice(-1):h;const r=choices.find(row=>snapshotOf(row).sha256===checked.sha256);if(!r||!equal(snapshotOf(r),checked))fail('PG_FULL_SOURCE_DENIED');await checkLegacy(r,!latest);return r;}
 async function full(context,work){
  exact(context,['scope','actor']);const c=scoped(context.scope,{scope:context.scope,actor:context.actor});await contract();
  const tx={permissionGate:c.gate,
   async verifyBindings(input){const g=c.authorized();exact(input,['grant','scope','bindings']);if(!equal(input.grant,g)||!equal(input.scope,c.scope))fail('PG_WORKFLOW_SCOPE_DENIED');const h=await history(c.scope),r=h.at(-1);if(!r||!equal(input.bindings,{uiScope:null,evidenceScope:r.session.scope}))fail('PG_FULL_SOURCE_DENIED');const resolved=await employee.resolveArchiveContext({credential:c.credential,scope:c.scope});return freeze({scope:c.scope,store:g.actor.store,uiScope:null,evidenceScope:r.session.scope,revision:resolved.bindingRevision});},
   async verifyPhotoRefs(input){exact(input,['grant','scope','photoRefs']);if(!equal(input.grant,c.authorized())||!equal(input.scope,c.scope))fail('PG_WORKFLOW_SCOPE_DENIED');return verifyPhotos(c,input.photoRefs);},
   async verifySourceSnapshots(input){exact(input,['grant','snapshot']);if(!equal(input.grant,c.authorized()))fail('PG_WORKFLOW_SCOPE_DENIED');await sourceSnapshot(c.scope,input.snapshot);return true;},
   async readVersions(){c.authorized();return fullHistory(c.scope);},
   async findReceipt({requestKey}){const g=c.authorized(),r=await fullReceipt(requestKey);if(r&&!equal(r.scope,c.scope))throw new FullWorkflowArchiveError('FULL_REQUEST_CONFLICT');if(r){const v=(await fullHistory(c.scope))[r.version-1];if(!v||!equal(v.actor,g.actor))throw new FullWorkflowArchiveError('FULL_REQUEST_CONFLICT');}return freeze(copy(r));},
   async appendVersion(input){
    needWrite();exact(input,['version','receipt','expectedVersion','expectedParentDigest']);const g=c.authorized(),chain=await fullHistory(c.scope),head=chain.at(-1),v=input.version;
    if((head?.version??0)!==input.expectedVersion||(head?.sha256??null)!==input.expectedParentDigest)return false;
    validateFullWorkflowChain([...chain,v],c.scope);if(!equal(v.actor,g.actor))fail('PG_WORKFLOW_SCOPE_DENIED');try{await sourceSnapshot(c.scope,v.snapshot,true);}catch(e){if(e.code==='PG_FULL_SOURCE_DENIED')throw new FullWorkflowArchiveError('FULL_SOURCE_SNAPSHOT_DENIED');throw e;}await verifyPhotos(c,v.snapshot.photoRefs);
    const key=digest([v.actor,v.requestId]),expected={requestKey:key,fingerprint:digest({actor:v.actor,scope:c.scope,requestId:v.requestId,expectedVersion:input.expectedVersion,expectedParentDigest:input.expectedParentDigest,snapshotSha256:v.snapshot.sha256}),scope:c.scope,version:v.version,sha256:v.sha256};if(!equal(input.receipt,expected))fail('PG_FULL_CORRUPT');
    const saved=await rows('INSERT INTO design_private.full_versions(scope_key,version,record,sha256) SELECT $1,$2::integer,$3::jsonb,$4 WHERE (SELECT coalesce(max(version),0) FROM design_private.full_versions WHERE scope_key=$1)=$5::integer RETURNING sha256',[digest(c.scope),v.version,canonical(v),v.sha256,input.expectedVersion],1);if(saved.length!==1||saved[0].sha256!==v.sha256)return false;
    const receipt=await one('INSERT INTO design_private.full_receipts(request_key,receipt) VALUES($1,$2::jsonb) RETURNING receipt',[key,canonical(expected)]);if(!equal(receipt.receipt,expected))fail('PG_FULL_CORRUPT');markWrite();return true;
   },beforeCommit:hook=>base.beforeCommit(hook)};
  CONTEXTS.set(tx,{operations:api,context:c});return work(Object.freeze(tx));
 }
 async function media(binding,credential,work){
  binding=mediaBinding(binding);const c=scoped(binding.scope,{scope:binding.scope,actor:{username:binding.owner,store:binding.store}});await c.gate.authorize(credential,binding.scope);await contract();
  const observed=new Map();
  const tx={permissionGate:c.gate,
   async readRecord(id){c.authorized();const r=await readMedia(binding,id);observed.set(id,r);return r;},
   async insertImmutable(record){needWrite();const r=mediaRecord(record);if(!equal(r.binding,binding))fail('PG_MEDIA_DENIED');if(await readMedia(binding,r.mediaId)!==null)return false;
    const key=digest(binding),sha=digest(r),saved=await one('INSERT INTO design_private.media_records(binding_key,media_id,record,record_sha256) VALUES($1,$2,$3::jsonb,$4) RETURNING record_sha256',[key,r.mediaId,canonical(r),sha]);if(saved.record_sha256!==sha)fail('PG_MEDIA_CORRUPT');
    const access=await one('INSERT INTO design_private.media_access(binding_key,media_id,active,revision) VALUES($1,$2,true,1) RETURNING active',[key,r.mediaId]);if(access.active!==true)fail('PG_MEDIA_CORRUPT');observed.set(r.mediaId,r);markWrite();return true;},
   beforeCommit:hook=>base.beforeCommit(hook)};
  await base.beforeCommit(async()=>{for(const [id,old] of observed){if(!equal(await readMedia(binding,id),old))fail('PG_MEDIA_DENIED');}await c.recheck();});return work(Object.freeze(tx));
 }
 async function verifySynthesis(input,acceptance=false){
  const scope=validateProductionDesignScope(input.scope),expectedActor=actor(input.actor),c=scoped(scope,{scope,actor:expectedActor});await c.gate.authorize(input.credential,scope);
  const record=(await history(scope)).at(-1);if(!record)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(record);
  if(Object.hasOwn(input,'candidateId')){
   const row=acceptance?await candidateRow(input.candidateId):await candidateFor(c,input.candidateId,record);
   const candidate=row.candidate;if(candidate.kind!=='completion_synthesis'||!equal(candidate.actor,expectedActor)||!equal(candidate.scope,scope)||!row.active)fail('PG_CANDIDATE_DENIED');
   validateCandidateAt(candidate,record);
   if(acceptance){if(!row.consumed)fail('PG_CANDIDATE_DENIED');const accepted=record.modelCandidates?.find(value=>value.candidate.id===candidate.id);if(!accepted)fail('PG_CANDIDATE_CORRUPT');await verifyAcceptedCandidate(accepted,record,digest([candidate.actor,accepted.acceptance.requestId]));await activeSynthesisAncestors(c,candidate,record);await candidateMedia(c,candidate.sourceRefs,record,candidate);}
   else{const expected={sessionId:candidate.sessionId,baseRevision:candidate.baseRevision,inputDigest:candidate.inputDigest,synthesis:candidate.synthesis,sourceRefs:candidate.sourceRefs};if(!equal(Object.fromEntries(Object.keys(expected).map(key=>[key,input[key]])),expected))fail('PG_CANDIDATE_DENIED');}
  }else{
   if(record.session.scope.sessionId!==input.sessionId||record.session.revision!==input.baseRevision||digest(record.session)!==input.inputDigest)fail('PG_CANDIDATE_DENIED');
   try{validateSynthesisContext({session:record.session,modelCandidates:record.modelCandidates??[],synthesis:input.synthesis,sourceRefs:input.sourceRefs});}catch{fail('PG_CANDIDATE_DENIED');}
   const candidate={kind:'completion_synthesis',synthesis:input.synthesis,sourceRefs:input.sourceRefs},verifiedRefs=await activeSynthesisAncestors(c,candidate,record);
   // Each exact ancestor pair has just had its attached metadata, original hash
   // and current access checked under this transaction's locks. Preserve the
   // flattened uniqueness/ordering check without rereading the same media rows.
   if(!equal(verifiedRefs,input.sourceRefs)||new Set(verifiedRefs.map(ref=>ref.mediaId)).size!==verifiedRefs.length)fail('PG_CANDIDATE_DENIED');
  }
  await c.recheck();return true;
 }
 const api=Object.freeze({workflow,initialize,full,media,publishCandidate,loadCandidate,verifySynthesis,async verifyCandidateMedia({credential,scope,actor:expectedActor,sourceRefs}){
   scope=validateProductionDesignScope(scope);actor(expectedActor);const c=scoped(scope,{scope,actor:expectedActor});await c.gate.authorize(credential,scope);const record=(await history(scope)).at(-1);if(!record)fail('PG_WORKFLOW_NOT_INITIALIZED');await checkLegacy(record);await candidateMedia(c,sourceRefs,record);await c.recheck();return true;
  },async resolveMedia({credential,grant:expected,scope,mediaIds,transaction}){
   const stored=CONTEXTS.get(transaction);if(!stored||stored.operations!==api||!equal(stored.context.scope,scope))fail('PG_WORKFLOW_SCOPE_DENIED');await stored.context.gate.authorize(credential,scope);if(!equal(stored.context.authorized(),expected))fail('PG_WORKFLOW_SCOPE_DENIED');const refs=await mediaReferences(stored.context,mediaIds);await stored.context.recheck();return refs;
  },async verifyMedia({credential,scope,mediaIds}){const c=scoped(scope);await c.gate.authorize(credential,scope);const refs=await mediaReferences(c,mediaIds);await c.recheck();return refs;},
  async verifyFull({credential,scope,versions,expectedGrant}){const c=scoped(scope,expectedGrant);await c.gate.authorize(credential,scope);validateFullWorkflowChain(versions,scope);for(const v of versions){await sourceSnapshot(scope,v.snapshot);await verifyPhotos(c,v.snapshot.photoRefs);}await c.recheck();return true;}
 });return api;
}
/** Public server factory; all capabilities still need an explicitly configured executor. */
export function createDesignPostgresRepositories({executor}={}){
 const configured=()=>{if(!executor||['readTransaction','writeTransaction'].some(k=>typeof executor[k]!=='function'))fail('PG_WORKFLOW_NOT_CONFIGURED');};
 const call=(write,work)=>{configured();return executor[write?'writeTransaction':'readTransaction'](tx=>{if(!tx.workflowRepositories)fail('PG_WORKFLOW_NOT_CONFIGURED');return work(tx);});};
 const employeeAdapter=Object.freeze({
  authenticate:credential=>call(false,tx=>createProductionEmployeeAdapter(tx).authenticate(credential)),
  resolveArchiveContext:request=>call(false,tx=>createProductionEmployeeAdapter(tx).resolveArchiveContext(request)),
  gate:Object.freeze({authorize:(credential,scope)=>call(false,tx=>createProductionEmployeeAdapter(tx).gate.authorize(credential,scope))}),
 });
 const workflowRepository=Object.freeze({transaction:(context,work)=>call(true,tx=>tx.workflowRepositories.workflow(context,work))});
 const fullArchiveTransaction=(context,work)=>call(true,tx=>tx.workflowRepositories.full(context,work));
 const mediaResolver=input=>{const saved=CONTEXTS.get(input.transaction);if(!saved)fail('PG_WORKFLOW_SCOPE_DENIED');return saved.operations.resolveMedia(input);};
 const mediaVerifier=input=>call(false,tx=>tx.workflowRepositories.verifyMedia(input));
 async function loadFullArchive(input){
  exact(input,['credential','scope']);const credential=input.credential,scope=validateProductionDesignScope(input.scope);
  const initial=await employeeAdapter.gate.authorize(credential,scope);
  const versions=await fullArchiveTransaction({scope,actor:initial.actor},async tx=>{
   const check=async()=>{if(!equal(await tx.permissionGate.authorize(credential,scope),initial))fail('PG_WORKFLOW_SCOPE_DENIED');};await check();const chain=await tx.readVersions();
   for(const v of chain){await tx.verifyBindings({grant:initial,scope,bindings:v.snapshot.bindings});await tx.verifySourceSnapshots({grant:initial,snapshot:v.snapshot});await tx.verifyPhotoRefs({grant:initial,scope,photoRefs:v.snapshot.photoRefs});}
   await tx.beforeCommit(check);return chain;
  });
  await call(false,tx=>tx.workflowRepositories.verifyFull({credential,scope,versions,expectedGrant:initial}));const head=versions.at(-1);return freeze({currentVersion:head?.version??0,currentDigest:head?.sha256??null,versions});
 }
 return Object.freeze({employeeAdapter,workflowRepository,fullArchiveTransaction,mediaResolver,mediaVerifier,resolveVisitScope:createVisitScopeResolver({executor}),listAuthorizedVisits:createVisitListService({executor}),
  verifyCandidateMedia:request=>{exact(request,['credential','scope','actor','sourceRefs']);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope),actor:actor(request.actor),sourceRefs:freeze(copy(request.sourceRefs))};return call(false,tx=>tx.workflowRepositories.verifyCandidateMedia(fixed));},
  async verifySynthesisAncestors(request){
   const keys=['credential','scope','actor','sessionId','baseRevision','inputDigest','synthesis','sourceRefs'];if(plain(request)&&Object.hasOwn(request,'candidateId'))keys.push('candidateId');exact(request,keys);
   const fixed={...freeze(copy(request)),scope:validateProductionDesignScope(request.scope),actor:actor(request.actor)};
   await call(false,tx=>tx.workflowRepositories.verifySynthesis(fixed));return call(false,tx=>tx.workflowRepositories.verifySynthesis(fixed));
  },
  async verifySynthesisAcceptance(request){
   exact(request,['credential','scope','actor','candidateId']);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope),actor:actor(request.actor),candidateId:request.candidateId};
   await call(false,tx=>tx.workflowRepositories.verifySynthesis(fixed,true));return call(false,tx=>tx.workflowRepositories.verifySynthesis(fixed,true));
  },
  createCandidateRepository({ttlMs}={}){
   const ready=()=>{if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)fail('PG_CANDIDATE_NOT_CONFIGURED');};
   return Object.freeze({
    async publish(request){
     ready();exact(request,['credential','scope','candidate']);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope),candidate:freeze(copy(request.candidate)),ttlMs};
     const result=await call(true,tx=>tx.workflowRepositories.publishCandidate(fixed));
     try{const latest=await call(false,tx=>tx.workflowRepositories.loadCandidate({credential:fixed.credential,scope:fixed.scope,candidateId:result.candidate.id,expectedActor:result.candidate.actor,requireCurrent:!result.replayed}));if(!equal(latest.candidate,result.candidate))fail('PG_CANDIDATE_CORRUPT');return freeze(copy(result));}catch{fail('PG_CANDIDATE_OUTCOME_UNCERTAIN');}
    },
    async load(request){
     ready();exact(request,['credential','scope','candidateId']);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope),candidateId:request.candidateId};
     const first=await call(false,tx=>tx.workflowRepositories.loadCandidate(fixed));const latest=await call(false,tx=>tx.workflowRepositories.loadCandidate({...fixed,expectedActor:first.candidate.actor}));if(!equal(first,latest))fail('PG_CANDIDATE_CORRUPT');return freeze(copy(latest));
    },
   });
  },
  initializeWorkflow:request=>{exact(request,['credential','scope']);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope)};return call(true,tx=>tx.workflowRepositories.initialize(fixed));},loadFullArchive,
  createFullWorkflowArchive({enabled=false}={}){const inner=createPreparedFullWorkflowArchive({enabled,permissionGate:employeeAdapter.gate,transaction:fullArchiveTransaction});return Object.freeze({async append(request){if(enabled!==true)return inner.append(request);const fixed={credential:request.credential,scope:validateProductionDesignScope(request.scope)};const result=await inner.append(request);try{const current=await loadFullArchive(fixed);if(!equal(current.versions[result.appliedVersion-1],result.version))fail('PG_FULL_CORRUPT');await call(false,tx=>tx.workflowRepositories.verifyFull({...fixed,versions:current.versions,expectedGrant:{actor:result.version.actor,scope:fixed.scope}}));return result;}catch{throw new FullWorkflowArchiveError('FULL_OUTCOME_UNCERTAIN');}}});},
  createMediaMetadataRepository({resolveCredential}={}){
   const credential=async binding=>{if(typeof resolveCredential!=='function')fail('PG_MEDIA_AUTH_REQUIRED');return resolveCredential(freeze(copy(binding)));};
   return Object.freeze({withScopeLock:async(binding,work)=>{binding=mediaBinding(binding);const token=await credential(binding);return call(true,tx=>tx.workflowRepositories.media(binding,token,work));},
    async verifyRecords(binding,records){binding=mediaBinding(binding);if(!Array.isArray(records)||records.length>300)fail('PG_MEDIA_INVALID');const expected=records.map(mediaRecord),token=await credential(binding);return call(true,tx=>tx.workflowRepositories.media(binding,token,async m=>{for(const r of expected){if(!equal(r.binding,binding)||!equal(await m.readRecord(r.mediaId),r))return false;}return true;}));}
   });
  },
 });
}
