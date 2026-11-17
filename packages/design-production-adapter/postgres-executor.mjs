import {createDesignDiagnostics} from '../shared/design-diagnostics.mjs';
/** Prepared Node server executor. No driver, connection string, secrets, DDL or network defaults. */
import {createHash,randomUUID} from 'node:crypto';
import {createVisitBindingAdapter,validateVisitBindingHistory,VisitBindingError} from './visit-binding.mjs';
import {validateProductionDesignScope,ProductionEmployeeError} from './employee-adapter.mjs';
import {validateLegacyArchiveSnapshot,ProductionArchiveError} from './archive-adapter.mjs';
import {createExplicitVisitLifecyclePolicy,VisitLifecycleError} from './lifecycle-policy.mjs';
import {DesignAccessError} from '../design-access-gate/index.mjs';
import {createPostgresWorkflowOperations,PostgresWorkflowError} from './postgres-workflow-repositories.mjs';
import {PreparedWorkflowError} from './prepared-workflow-service.mjs';
import {FullWorkflowArchiveError} from './full-workflow-archive.mjs';
import {VisitListError} from './visit-list-service.mjs';
export const DESIGN_POSTGRES_CONTRACT='design-postgres-v1';
export class DesignPostgresError extends Error {
  constructor(code,outcome='not_committed'){super(code);this.name='DesignPostgresError';this.code=code;this.outcome=outcome;this.retryable=false;}
}
// Reconstruct only fixed known errors. Driver names/messages never establish trust.
const SAFE_ERRORS=[
  [VisitListError,new Set(['VISIT_LIST_INVALID_REQUEST','VISIT_LIST_INVALID_DATE','VISIT_LIST_NOT_CONFIGURED','VISIT_LIST_ACCESS_DENIED','VISIT_LIST_UNAVAILABLE','VISIT_LIST_CHANGED','VISIT_LIST_LIMIT_EXCEEDED'])],
  [PostgresWorkflowError,new Set(['PG_CANDIDATE_DENIED', 'PG_CANDIDATE_CORRUPT', 'PG_CANDIDATE_CONFLICT', 'PG_CANDIDATE_NOT_CONFIGURED', 'PG_CANDIDATE_OUTCOME_UNCERTAIN', 'FULL_OUTCOME_UNCERTAIN', 'PG_FULL_CORRUPT', 'PG_FULL_SOURCE_DENIED', 'PG_LEGACY_IMPORT_REQUIRED', 'PG_LEGACY_SOURCE_CHANGED', 'PG_MEDIA_AUTH_REQUIRED', 'PG_MEDIA_CORRUPT', 'PG_MEDIA_DENIED', 'PG_MEDIA_INVALID', 'PG_WORKFLOW_AUTH_REQUIRED', 'PG_WORKFLOW_CAPACITY', 'PG_WORKFLOW_CORRUPT', 'PG_WORKFLOW_INVALID', 'PG_WORKFLOW_NOT_CONFIGURED', 'PG_WORKFLOW_NOT_INITIALIZED', 'PG_WORKFLOW_NOT_INSTALLED', 'PG_WORKFLOW_SCOPE_DENIED'])],
  [PreparedWorkflowError,new Set(['WORKFLOW_CANDIDATE_DENIED', 'WORKFLOW_ACCESS_DENIED', 'WORKFLOW_ARCHIVED', 'WORKFLOW_ARCHIVE_COMMAND_REQUIRED', 'WORKFLOW_ARCHIVE_REQUIRED', 'WORKFLOW_AUTHORIZATION_CHANGED', 'WORKFLOW_CARE_AFTER_ONLY', 'WORKFLOW_CONFIRMATION_INVALID', 'WORKFLOW_CONTRACT_REJECTED', 'WORKFLOW_DISABLED', 'WORKFLOW_EXPLICIT_NUMBER_REQUIRED', 'WORKFLOW_INVALID_FIELD', 'WORKFLOW_INVALID_FIELDS', 'WORKFLOW_INVALID_GROUP', 'WORKFLOW_INVALID_ID', 'WORKFLOW_INVALID_INTENT', 'WORKFLOW_INVALID_SOURCE', 'WORKFLOW_INVALID_TEXT', 'WORKFLOW_INVALID_VALUE', 'WORKFLOW_MEDIA_DENIED', 'WORKFLOW_MEDIA_DUPLICATE', 'WORKFLOW_NOT_CONFIGURED', 'WORKFLOW_OUTCOME_UNCERTAIN', 'WORKFLOW_RECORD_INVALID', 'WORKFLOW_REQUEST_CONFLICT', 'WORKFLOW_REVISION_CONFLICT', 'WORKFLOW_SCOPE_MISMATCH', 'WORKFLOW_TRANSACTION_INVALID'])],
  [FullWorkflowArchiveError,new Set(['FULL_MODEL_HISTORY_INVALID', 'FULL_ACCESS_DENIED', 'FULL_AUTHORIZATION_CHANGED', 'FULL_BINDING_DENIED', 'FULL_CHAIN_LIMIT', 'FULL_COMMIT_VALIDATION_FAILED', 'FULL_DISABLED', 'FULL_EMPTY_SNAPSHOT', 'FULL_EVIDENCE_INVALID', 'FULL_EXPLICIT_MIGRATION_REQUIRED', 'FULL_HISTORY_REWRITE', 'FULL_INVALID_FIELDS', 'FULL_INVALID_ID', 'FULL_INVALID_JSON', 'FULL_INVALID_VERSION', 'FULL_LEGACY_HISTORY_INCOMPLETE', 'FULL_LEGACY_INVALID', 'FULL_NATIVE_ARCHIVE_INVALID', 'FULL_NATIVE_HISTORY_INCOMPLETE', 'FULL_NONCANONICAL_SERIALIZATION', 'FULL_NOT_CONFIGURED', 'FULL_OUTCOME_UNCERTAIN', 'FULL_PARENT_MISMATCH', 'FULL_PHOTO_INVALID', 'FULL_PHOTO_REFERENCE_MISSING', 'FULL_RECEIPT_INVALID', 'FULL_REQUEST_CONFLICT', 'FULL_SCHEMA_INVALID', 'FULL_SCOPE_MISMATCH', 'FULL_SNAPSHOT_TAMPERED', 'FULL_SOURCE_SNAPSHOT_DENIED', 'FULL_TOO_LARGE', 'FULL_TRANSACTION_REENTRY', 'FULL_UI_INVALID', 'FULL_VERSION_CONFLICT', 'FULL_VERSION_TAMPERED'])],
  [DesignPostgresError,new Set(['PG_APPROVAL_INVALID', 'PG_AUTHORITY_EXPIRED', 'PG_BEGIN_UNCERTAIN', 'PG_CAS_FAILED', 'PG_CLIENT_ALREADY_LEASED', 'PG_CLIENT_INVALID', 'PG_COMMIT_GUARD_REQUIRED', 'PG_COMMIT_UNCERTAIN', 'PG_CONCURRENT_CLIENT_USE', 'PG_CONTRACT_UNAVAILABLE', 'PG_GUARD_INVALID', 'PG_INVALID_INPUT', 'PG_LIFECYCLE_UNCONFIRMED', 'PG_NOT_CONFIGURED', 'PG_QUERY_NOT_ALLOWED', 'PG_RECEIPT_INVALID', 'PG_RESULT_INVALID', 'PG_ROLLBACK_UNCERTAIN', 'PG_RPC_NOT_ALLOWED', 'PG_TRANSACTION_CLOSED', 'PG_TRANSACTION_FAILED', 'PG_UNAWAITED_QUERY', 'PG_WRITE_NOT_ALLOWED', 'PG_WRITE_NOT_AUTHORIZED'])],
  [VisitBindingError,new Set(['BINDING_ACTOR_CHANGED', 'BINDING_APPROVAL_EXPIRED', 'BINDING_APPROVAL_REQUIRED', 'BINDING_CLOCK_INVALID', 'BINDING_HISTORY_INVALID', 'BINDING_HISTORY_LIMIT', 'BINDING_INVALID_ACTOR', 'BINDING_INVALID_DATE', 'BINDING_INVALID_FIELDS', 'BINDING_INVALID_PROFILE', 'BINDING_INVALID_REQUEST', 'BINDING_INVALID_STATUS', 'BINDING_INVALID_VISIT', 'BINDING_LIFECYCLE_UNCONFIRMED', 'BINDING_NOT_FOUND', 'BINDING_OPERATOR_DENIED', 'BINDING_OUTCOME_UNCERTAIN', 'BINDING_PROFILE_MISMATCH', 'BINDING_READ_UNAVAILABLE', 'BINDING_RECEIPT_INVALID', 'BINDING_RECEIPT_MISSING', 'BINDING_REQUEST_CONFLICT', 'BINDING_REVISION_CONFLICT', 'BINDING_SCOPE_IMMUTABLE', 'BINDING_SOURCE_AMBIGUOUS', 'BINDING_SOURCE_CHANGED', 'BINDING_SOURCE_MISMATCH', 'BINDING_SOURCE_UNAVAILABLE', 'BINDING_STORE_DENIED', 'BINDING_STYLIST_INACTIVE', 'BINDING_TRANSACTION_NOT_CONFIGURED', 'BINDING_TRANSACTION_REENTRY', 'BINDING_TRANSITION_INVALID'])],
  [ProductionEmployeeError,new Set(['ASSIGNMENT_INVALID', 'ASSIGNMENT_STATUS_UNSUPPORTED', 'ASSIGNMENT_UNAVAILABLE', 'AUTHENTICATION_REQUIRED', 'CLOCK_INVALID', 'CUSTOMER_BINDING_CHANGED', 'CUSTOMER_BINDING_INVALID', 'CUSTOMER_BINDING_REQUIRED', 'CUSTOMER_BINDING_UNAVAILABLE', 'CUSTOMER_VISIT_DENIED', 'EMPLOYEE_ADAPTER_NOT_CONFIGURED', 'INVALID_SCOPE'])],
  [ProductionArchiveError,new Set(['ARCHIVE_AUTHORIZATION_CHANGED', 'ARCHIVE_CLIENT_UPGRADE_REQUIRED', 'ARCHIVE_INVALID_FIELDS', 'ARCHIVE_INVALID_ID', 'ARCHIVE_INVALID_PHOTOS', 'ARCHIVE_INVALID_STATUS', 'ARCHIVE_INVALID_TEXT', 'ARCHIVE_LINK_UNSUPPORTED', 'ARCHIVE_OUTCOME_UNCERTAIN', 'ARCHIVE_REASON_REQUIRED', 'ARCHIVE_REQUEST_CONFLICT', 'ARCHIVE_RESULT_INVALID', 'ARCHIVE_RESULT_PAYLOAD_MISMATCH', 'ARCHIVE_RESULT_SCOPE_MISMATCH', 'ARCHIVE_SCOPE_DENIED', 'ARCHIVE_TOO_LARGE', 'ARCHIVE_TRANSACTION_NOT_CONFIGURED', 'ARCHIVE_TRANSACTION_NOT_EXECUTED', 'ARCHIVE_TRANSACTION_REENTRY', 'ARCHIVE_VERSION_CONFLICT'])],
  [VisitLifecycleError,new Set(['LIFECYCLE_CONFIGURATION_INVALID', 'LIFECYCLE_INVALID_ROW', 'LIFECYCLE_UNCONFIRMED'])],
  [DesignAccessError,new Set(['ACTOR_CHANGED', 'ADAPTER_NOT_CONFIGURED', 'AUTHENTICATION_REQUIRED', 'CUSTOMER_VISIT_DENIED', 'INVALID_OPERATION', 'INVALID_SCOPE', 'RELATIONSHIP_DENIED', 'RELATIONSHIP_UNAVAILABLE'])],
];
const fail=code=>{throw new DesignPostgresError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('PG_INVALID_INPUT');};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const copy=v=>JSON.parse(canonical(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>canonical(a)===canonical(b);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const shaString=v=>createHash('sha256').update(v).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const integer=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v)&&Number.isSafeInteger(Number(v));
const text=(v,max=160)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
function visit(v){exact(v,['assignmentSource','visitId']);validateProductionDesignScope({customerProfileId:'1',...v});return freeze(copy(v));}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))fail('PG_INVALID_INPUT');return v;}
function timestamp(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('PG_RESULT_INVALID');return Date.parse(v);}
function validateActor(v){exact(v,['username','store']);if(!text(v.username,80)||!['自由手艺人','向里造型'].includes(v.store))fail('PG_INVALID_INPUT');}
function args(path){
  if(typeof path!=='string'||path.length>2048||!path.includes('?')||path.includes('#'))fail('PG_QUERY_NOT_ALLOWED');
  const [table,query,...tail]=path.split('?');if(tail.length)fail('PG_QUERY_NOT_ALLOWED');
  const params=new URLSearchParams(query),keys=[...params.keys()];
  if(new Set(keys).size!==keys.length||params.get('limit')!=='2')fail('PG_QUERY_NOT_ALLOWED');
  return {table,p:params,keys};
}
function paramsAre(keys,expected){if(keys.sort().join('|')!==expected.sort().join('|'))fail('PG_QUERY_NOT_ALLOWED');}
function quotedName(value){let name;try{if(!value?.startsWith('eq.'))fail('PG_QUERY_NOT_ALLOWED');name=JSON.parse(value.slice(3));}catch{fail('PG_QUERY_NOT_ALLOWED');}if(!text(name,80))fail('PG_QUERY_NOT_ALLOWED');return name;}
/** Acquire a FRESH exclusive pg-style lease. Client sharing, credentials and pool setup are caller responsibilities. */
export function createDesignPostgresExecutor({acquireClient,lifecyclePolicy=createExplicitVisitLifecyclePolicy(),diagnostics}={}){
  const diagnose=createDesignDiagnostics(diagnostics,'postgres');
  const leased=new WeakSet();
  async function execute(write,callback){
    if(typeof acquireClient!=='function'||typeof lifecyclePolicy?.evaluate!=='function'||typeof callback!=='function')fail('PG_NOT_CONFIGURED');
    let client,beginAttempted=false,begun=false,commitAttempted=false,committed=false,closed=false,busy=false,finalizing=false,leaseOwned=false;
    const hooks=[],deadlines=[];let writes=0,sessions=0,phase='acquire';
    const start=name=>{phase=name;diagnose(phase,'start');};
    const done=()=>diagnose(phase,'success');
    async function query(sql,values=[]){
      if(closed)fail('PG_TRANSACTION_CLOSED');if(busy)fail('PG_CONCURRENT_CLIENT_USE');busy=true;
      try{const r=await client.query(sql,values);if(!r||typeof r.command!=='string'||!Array.isArray(r.rows)||!((r.rowCount===null&&r.rows.length===0)||(Number.isSafeInteger(r.rowCount)&&r.rowCount>=0&&r.rows.length===r.rowCount)))fail('PG_RESULT_INVALID');return r;}
      finally{busy=false;}
    }
    async function rows(sql,values=[],max=257){const r=await query(sql,values);if(r.rows.length>max||r.rows.some(row=>!plain(row)))fail('PG_RESULT_INVALID');return copy(r.rows);}
    async function one(sql,values=[]){const r=await rows(sql,values,1);if(r.length!==1)fail('PG_RESULT_INVALID');return r[0];}
    async function dbNow(){const r=await one('SELECT clock_timestamp()::text AS now');return timestamp(r.now);}
    const needWrite=()=>{if(!write||finalizing)fail('PG_WRITE_NOT_ALLOWED');};
    function deadline(value){const n=timestamp(value);deadlines.push(n);return n;}
    function usable(){if(closed)fail('PG_TRANSACTION_CLOSED');}
    const tx={
      diagnostics,
      clock:()=>Date.now(),
      async beforeCommit(hook){usable();if(!write||finalizing||typeof hook!=='function'||hooks.length>=32)fail('PG_GUARD_INVALID');hooks.push(hook);},
      async listAssignedVisits(input){
        usable();exact(input,['actor','date']);validateActor(input.actor);
        const date=input.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<1||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('PG_INVALID_INPUT');
        // Candidate locators only. The listing service resolves every current
        // binding and profile in this transaction before releasing any display row.
        const values=[input.actor.username,input.actor.store,date];
        const bookings=await rows("SELECT 'appointment'::text AS \"assignmentSource\",'booking:'||id::text AS \"visitId\" FROM public.bookings WHERE barber_name=$1 AND shop_name=$2 AND date::date=$3::date ORDER BY id LIMIT 51 FOR SHARE",values,51);
        if(bookings.length>50)throw new VisitListError('VISIT_LIST_LIMIT_EXCEEDED');
        const frontdesk=await rows("SELECT 'frontdesk'::text AS \"assignmentSource\",'frontdesk:'||id::text AS \"visitId\" FROM public.frontdesk_today_customers WHERE barber_name=$1 AND store=$2 AND business_date=$3::date ORDER BY id LIMIT 51 FOR SHARE",values,51);
        if(bookings.length+frontdesk.length>50)throw new VisitListError('VISIT_LIST_LIMIT_EXCEEDED');
        const found=[...bookings,...frontdesk];for(const row of found)visit(row);return freeze(copy(found));
      },
      async restRows(path){
        usable();const {table,p,keys}=args(path),sel=p.get('select');let sql,values;
        if(table==='employee_booking_sessions'){
          paramsAre(keys,['select','token_hash','expires_at','limit']);
          if(sel!=='username,store,position,expires_at'||!/^eq\.[0-9a-f]{64}$/.test(p.get('token_hash')||'')||!p.get('expires_at')?.startsWith('gt.')||!Number.isFinite(Date.parse(p.get('expires_at').slice(3))))fail('PG_QUERY_NOT_ALLOWED');
          sql="SELECT jsonb_build_object('username',username,'store',store,'position',position,'expires_at',expires_at) AS row FROM public.employee_booking_sessions WHERE token_hash=$1 AND expires_at>clock_timestamp() LIMIT 2 FOR SHARE";values=[p.get('token_hash').slice(3)];
        }else if(table==='staff'){
          paramsAre(keys,['select','username','limit']);if(!['username,store,position,active,employment_status','username,store,active,employment_status'].includes(sel))fail('PG_QUERY_NOT_ALLOWED');
          sql="SELECT jsonb_build_object('username',username,'store',store,'position',position,'active',active,'employment_status',employment_status) AS row FROM public.staff WHERE username=$1 LIMIT 2 FOR SHARE";values=[quotedName(p.get('username'))];
        }else if(table==='bookings'){
          paramsAre(keys,['select','id','limit']);if(sel!=='id,barber_name,shop_name,date,status'||!p.get('id')?.startsWith('eq.')||!integer(p.get('id').slice(3)))fail('PG_QUERY_NOT_ALLOWED');
          sql="SELECT jsonb_build_object('id',id,'barber_name',barber_name,'shop_name',shop_name,'date',date::date,'status',status) AS row FROM public.bookings WHERE id=$1::bigint LIMIT 2 FOR SHARE";values=[p.get('id').slice(3)];
        }else if(table==='frontdesk_today_customers'){
          paramsAre(keys,['select','id','limit']);if(sel!=='id,barber_name,store,business_date,status'||!p.get('id')?.startsWith('eq.')||!UUID.test(p.get('id').slice(3)))fail('PG_QUERY_NOT_ALLOWED');
          sql="SELECT jsonb_build_object('id',id,'barber_name',barber_name,'store',store,'business_date',business_date,'status',status) AS row FROM public.frontdesk_today_customers WHERE id=$1::uuid LIMIT 2 FOR SHARE";values=[p.get('id').slice(3)];
        }else if(table==='customer_profiles'){
          paramsAre(keys,['select','id','limit']);if(!['id,shop_name','id,shop_name,card_packages,service_history','id,name,shop_name'].includes(sel)||!p.get('id')?.startsWith('eq.')||!integer(p.get('id').slice(3)))fail('PG_QUERY_NOT_ALLOWED');
          sql=sel==='id,name,shop_name'?"SELECT jsonb_build_object('id',id,'name',name,'shop_name',shop_name) AS row FROM public.customer_profiles WHERE id=$1::bigint LIMIT 2 FOR SHARE":"SELECT jsonb_build_object('id',id,'shop_name',shop_name,'card_packages',card_packages,'service_history',service_history) AS row FROM public.customer_profiles WHERE id=$1::bigint LIMIT 2 FOR SHARE";values=[p.get('id').slice(3)];
        }else fail('PG_QUERY_NOT_ALLOWED');
        const result=(await rows(sql,values,2)).map(r=>{exact(r,['row']);if(!plain(r.row))fail('PG_RESULT_INVALID');return r.row;});
        if(table==='employee_booking_sessions')for(const r of result){deadline(r.expires_at);sessions++;}
        return freeze(result);
      },
      async rpc(name,input){
        usable();const p=copy(input);
        if(name==='customer_design_resolve_context'){
          exact(p,['p_customer_profile_id','p_booking_id','p_booking_date','p_visit_key']);
          if(!Number.isSafeInteger(p.p_customer_profile_id)||p.p_customer_profile_id<1||(p.p_booking_id!==null&&(!Number.isSafeInteger(p.p_booking_id)||p.p_booking_id<1))||!text(p.p_booking_date,10)||!text(p.p_visit_key))fail('PG_INVALID_INPUT');
          const row=await one('SELECT public.customer_design_resolve_context($1::bigint,$2::bigint,$3::date,$4::text) AS result',[p.p_customer_profile_id,p.p_booking_id,p.p_booking_date,p.p_visit_key]);
          if(!plain(row.result))fail('PG_RESULT_INVALID');
          return freeze(copy(Object.fromEntries(['customer_profile_id','booking_id','booking_date','visit_key','store'].map(k=>[k,row.result[k]]))));
        }
        if(name==='append_customer_design_version'){
          needWrite();exact(p,['p_payload','p_actor','p_source']);if(!sessions||!hooks.length||!text(p.p_actor,80)||p.p_source!=='manual')fail('PG_WRITE_NOT_AUTHORIZED');
          const q=p.p_payload;exact(q,['customer_profile_id','booking_id','booking_date','visit_key','store','baseline','optimized','reasons','execution','process','review','status','photo_ids','archive_url','request_id','expected_latest_version_id']);
          uuid(q.request_id);if(q.expected_latest_version_id!==null)uuid(q.expected_latest_version_id);
          validateLegacyArchiveSnapshot(Object.fromEntries(['baseline','optimized','reasons','execution','process','review','status','photo_ids','archive_url'].map(k=>[k,q[k]])));
          const row=await one('SELECT public.append_customer_design_version($1::jsonb,$2::text,$3::text) AS result',[canonical(q),p.p_actor,p.p_source]);
          if(!plain(row.result))fail('PG_RESULT_INVALID');writes++;return freeze(copy(row.result));
        }
        fail('PG_RPC_NOT_ALLOWED');
      },
      async readBindingHistory(input){usable();const v=visit(input);const result=await rows('SELECT record FROM design_private.binding_versions WHERE assignment_source=$1 AND visit_id=$2 ORDER BY revision LIMIT 257 FOR SHARE',[v.assignmentSource,v.visitId]);return validateVisitBindingHistory(result.map(r=>{exact(r,['record']);return r.record;}),v);},
      async readRequest(id){usable();uuid(id);const result=await rows('SELECT receipt FROM design_private.binding_requests WHERE request_id=$1::uuid FOR SHARE',[id],1);return result.length?freeze(copy(result[0].receipt)):null;},
      async evaluateLifecycle(row){
        usable();const v=visit({assignmentSource:row.source,visitId:row.visitId});
        const found=await rows('SELECT row_sha256,allowed,policy_revision,expires_at::text AS expires_at FROM design_private.lifecycle_decisions WHERE assignment_source=$1 AND visit_id=$2 FOR SHARE',[v.assignmentSource,v.visitId],1);
        if(found.length!==1)fail('PG_LIFECYCLE_UNCONFIRMED');const d=found[0];
        const decision={rowSha256:d.row_sha256,allowed:d.allowed,policyRevision:d.policy_revision,expiresAt:timestamp(d.expires_at)};
        const answer=await lifecyclePolicy.evaluate(freeze({row:copy(row),decision,now:await dbNow()}));
        exact(answer,['allowed','policyRevision']);if(answer.allowed!==true||answer.policyRevision!==decision.policyRevision||!text(answer.policyRevision)||decision.allowed!==true||decision.expiresAt<=await dbNow())fail('PG_LIFECYCLE_UNCONFIRMED');
        deadline(d.expires_at);return freeze(copy(answer));
      },
      async authorizeOperator(input){
        usable();exact(input,['actor','action','visit','customerProfileId']);validateActor(input.actor);visit(input.visit);if(!integer(input.customerProfileId)||!['bind','reassign','revoke','restore'].includes(input.action))fail('PG_INVALID_INPUT');
        const result=await rows('SELECT allowed FROM design_private.binding_authorities WHERE username=$1 AND store=$2 AND action=$3 FOR SHARE',[input.actor.username,input.actor.store,input.action],1);return result.length===1&&result[0].allowed===true;
      },
      async consumeApproval(input){
        needWrite();exact(input,['approval','intent','intentSha256']);if(!text(input.approval,512)||!SHA.test(input.intentSha256)||digest(input.intent)!==input.intentSha256)fail('PG_APPROVAL_INVALID');
        const intent=copy(input.intent),requestId=uuid(intent.command?.requestId),hash=shaString(input.approval);
        const result=await rows('SELECT receipt_id::text AS receipt_id,intent_sha256,intent,expires_at::text AS expires_at,revoked,consumed_request_id::text AS consumed_request_id FROM design_private.binding_approvals WHERE approval_hash=$1 FOR UPDATE',[hash],1);
        const approval=result[0];if(!approval||approval.revoked!==false||approval.consumed_request_id!==null||approval.intent_sha256!==input.intentSha256||!same(approval.intent,intent)||timestamp(approval.expires_at)<=await dbNow())fail('PG_APPROVAL_INVALID');
        uuid(approval.receipt_id);
        const changed=await rows('UPDATE design_private.binding_approvals SET consumed_request_id=$2::uuid WHERE approval_hash=$1 AND consumed_request_id IS NULL AND revoked=false AND expires_at>clock_timestamp() RETURNING receipt_id::text AS receipt_id',[hash,requestId],1);
        if(changed.length!==1||changed[0].receipt_id!==approval.receipt_id)fail('PG_APPROVAL_INVALID');writes++;
        return freeze({receiptId:approval.receipt_id,intentSha256:input.intentSha256,expiresAt:deadline(approval.expires_at)});
      },
      async appendVersion(input){
        needWrite();exact(input,['expectedRevision','record','receipt']);if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!sessions)fail('PG_INVALID_INPUT');
        const r=copy(input.record),receipt=copy(input.receipt),v=visit(r.visit),existing=await tx.readBindingHistory(v);
        if(existing.length!==input.expectedRevision)return false;
        validateVisitBindingHistory([...existing,r],v);
        const command={requestId:r.requestId,expectedRevision:r.previousRevision,action:r.action,visit:r.visit,customerProfileId:r.customerProfileId};
        const expected={requestId:r.requestId,actor:r.actor,visit:r.visit,commandSha256:digest({actor:r.actor,command}),appliedRevision:r.revision,recordSha256:digest(r)};
        if(!same(receipt,expected))fail('PG_RECEIPT_INVALID');
        const approved=await rows('SELECT receipt_id::text AS receipt_id,intent,intent_sha256 FROM design_private.binding_approvals WHERE receipt_id=$1::uuid AND consumed_request_id=$2::uuid AND revoked=false AND expires_at>clock_timestamp() FOR SHARE',[uuid(r.authorityReceiptId),uuid(r.requestId)],1);
        const prior=existing.at(-1),intent={actor:r.actor,command,previousRevision:prior?.revision||0,previousState:prior?.state||null,target:{customerProfileId:r.customerProfileId,store:r.store,bookingDate:r.bookingDate,visitKey:r.visitKey,staffUsername:r.staffUsername},sourceStatus:r.sourceStatus,policyRevision:r.policyRevision};
        if(approved.length!==1||!same(approved[0].intent,intent)||approved[0].intent_sha256!==digest(intent))fail('PG_APPROVAL_INVALID');
        const inserted=await rows('INSERT INTO design_private.binding_versions(assignment_source,visit_id,revision,request_id,record) SELECT $1,$2,$3::integer,$4::uuid,$5::jsonb WHERE (SELECT coalesce(max(revision),0) FROM design_private.binding_versions WHERE assignment_source=$1 AND visit_id=$2)=$6::integer RETURNING record',[v.assignmentSource,v.visitId,r.revision,r.requestId,canonical(r),input.expectedRevision],1);
        if(inserted.length!==1||!same(inserted[0].record,r))fail('PG_CAS_FAILED');
        const saved=await one('INSERT INTO design_private.binding_requests(request_id,receipt) VALUES($1::uuid,$2::jsonb) RETURNING receipt',[r.requestId,canonical(receipt)]);if(!same(saved.receipt,receipt))fail('PG_RECEIPT_INVALID');writes++;return true;
      },
    };
    tx.resolveVisitBinding=row=>{usable();return createVisitBindingAdapter({readTransaction:cb=>cb(tx),clock:tx.clock,diagnostics}).resolveVisitBinding(row);};
    tx.workflowRepositories=createPostgresWorkflowOperations({base:tx,rows,one,needWrite,markWrite:()=>{writes++;},usable,dbNow,deadline});
    try{
      start('acquire');client=await acquireClient();
      if(!client||(typeof client!=='object'&&typeof client!=='function')||typeof client.query!=='function'||typeof client.release!=='function')fail('PG_CLIENT_INVALID');
      if(leased.has(client))fail('PG_CLIENT_ALREADY_LEASED');leased.add(client);leaseOwned=true;done();
      start('begin');beginAttempted=true;
      if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')fail('PG_RESULT_INVALID');begun=true;done();start('transaction_setup');
      await query("SET LOCAL lock_timeout = '5s'");await query("SET LOCAL statement_timeout = '30s'");await query("SET LOCAL idle_in_transaction_session_timeout = '30s'");await query("SET LOCAL search_path = pg_catalog");
      await one("SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) AS locked");
      const contract=await one("SELECT version,EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='design_private.commit_checks'::regclass AND tgname='design_commit_deadline' AND tgdeferrable AND tginitdeferred AND tgenabled='O') AS deadline_guard FROM design_private.runtime_contract WHERE id=true FOR SHARE");
      if(contract.version!==DESIGN_POSTGRES_CONTRACT||contract.deadline_guard!==true)fail('PG_CONTRACT_UNAVAILABLE');done();start('callback');
      const result=await callback(Object.freeze(tx));done();start('guard');
      if(busy)fail('PG_UNAWAITED_QUERY');finalizing=true;
      for(const hook of hooks)await hook();
      if(busy)fail('PG_UNAWAITED_QUERY');
      if(writes){
        if(!hooks.length||!sessions||!deadlines.length)fail('PG_COMMIT_GUARD_REQUIRED');
        const expires=Math.min(...deadlines);if(expires<=await dbNow())fail('PG_AUTHORITY_EXPIRED');
        const checked=await one('INSERT INTO design_private.commit_checks(id,expires_at) VALUES($1::uuid,to_timestamp($2::double precision/1000)) RETURNING id::text AS id',[randomUUID(),expires]);uuid(checked.id);
      }
      done();start('commit');commitAttempted=true;const ack=await query('COMMIT');if(ack.command!=='COMMIT')throw new DesignPostgresError('PG_COMMIT_UNCERTAIN','uncertain');committed=true;closed=true;done();
      return result;
    }catch(error){
      diagnose(phase,'failure','dependency');
      closed=true;let rollbackFailed=false;
      if(leaseOwned&&beginAttempted&&!committed)try{diagnose('rollback','start');await client.query('ROLLBACK',[]);diagnose('rollback','success');}catch{rollbackFailed=true;diagnose('rollback','failure','dependency');}
      closed=true;
      if(commitAttempted)throw new DesignPostgresError('PG_COMMIT_UNCERTAIN','uncertain');
      if(beginAttempted&&!begun)throw new DesignPostgresError('PG_BEGIN_UNCERTAIN','uncertain');
      if(rollbackFailed)throw new DesignPostgresError('PG_ROLLBACK_UNCERTAIN','uncertain');
      // Only already-sanitized adapter failures and enumerated SQLSTATEs leave this boundary.
      for(const [ErrorClass,codes] of SAFE_ERRORS)if(error instanceof ErrorClass&&codes.has(error.code))throw new ErrorClass(error.code);
      if(error?.code==='22023'&&['CUSTOMER_DESIGN_REQUEST_REUSED','CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED'].includes(error?.message))throw new DesignPostgresError(error.message);
      if(['40001','40P01','55P03','57014','23505','42501','P0002'].includes(error?.code))throw new DesignPostgresError(error.code);
      throw new DesignPostgresError('PG_TRANSACTION_FAILED');
    }finally{
      closed=true;
      if(leaseOwned){try{diagnose('release','start');await client.release(committed?undefined:new Error('Discard failed design transaction lease'));leased.delete(client);diagnose('release','success');}catch{diagnose('release','failure','dependency');/* Keep a failed-release lease quarantined; acknowledged COMMIT stays committed. */}}
    }
  }
  return Object.freeze({readTransaction:callback=>execute(false,callback),writeTransaction:callback=>execute(true,callback),transaction:callback=>execute(true,callback)});
}
