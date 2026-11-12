import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {stableHistoryJson,HISTORY_REPARSE_PARSER} from '../supabase/functions/_shared/history-reparse-plan.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const source=api.slice(api.indexOf('const HISTORY_REPARSE_CODE_DIGEST ='),api.indexOf('\nasync function historyImportPreview('));
const expectedCode=digest(Buffer.concat([fs.readFileSync('supabase/functions/_shared/zysyr-history-import.mjs'),Buffer.from('\n'),fs.readFileSync('supabase/functions/_shared/history-reparse-plan.mjs')]));
assert(source.includes(expectedCode),'parser digest must cover actual source bytes');
const bytes=new Uint8Array([1,2,3]),stateHash='a'.repeat(64),sourceHash=digest(bytes);
const decisions=[{import_row_id:'row-a',disposition:'include',effective_mapped:{amount:0}}];
const plan={decisions,counts:{original:1,included:1,excluded:0,changed:1}};
let allowed=true,hash=sourceHash,size=3,fetchOk=true,status={status:'not_found'},writes=0,downloads=0,lastBody;
const sandbox={stableHistoryJson,HISTORY_REPARSE_PARSER,Uint8Array,
  historyImportFinance:()=>{if(!allowed)throw Error('denied');},
  selectedStoreInfo:async()=>({company_id:'company-a',id:'store-a'}),
  uuidValue:v=>{if(!v)throw Error('invalid-id');return v;},
  cleanText:(v,max=500)=>String(v??'').trim().slice(0,max),
  storagePath:v=>v,exactArrayBuffer:v=>v.buffer,
  sha256Bytes:async v=>digest(v),sha256:async v=>digest(v),
  MAX_REPORT_BYTES:10,SUPABASE_URL:'https://example.invalid',SERVICE_KEY:'test-only',
  buildHistoryReparsePlan:()=>plan,
  ExcelJS:{Workbook:class{constructor(){this.xlsx={load:async()=>{}};}}},
  fetch:async()=>{downloads++;return {ok:fetchOk,status:503,arrayBuffer:async()=>bytes.buffer};},
  rpcSaved:async(path,body)=>{
    assert.equal(body.p_actor_user_id,'actor-a');assert.equal(body.p_store_id,'store-a');assert.equal(body.p_company_id,'company-a');assert.equal(body.p_batch_id,'batch-a');
    if(path.endsWith('_state'))return {batch:{source_sha256:hash,source_size_bytes:size,source_bucket_id:'private',source_object_path:'a.xlsx'},rows:[],state_fingerprint:stateHash};
    if(path.endsWith('_status'))return status;
    assert(path.endsWith('_apply'));writes++;lastBody=body;return {formal_ledger_written:false,financial_acceptance_performed:false,generation:1};
  },
};
vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(source+'\nthis.preview=historyImportReparsePreview;this.apply=historyImportReparseApply;this.status=historyImportReparseStatus;'),sandbox);
const session={auth_account_id:'actor-a'},payload={import_batch_id:'batch-a'};
const preview=await sandbox.preview(payload,session);assert.equal(writes,0);assert.equal(preview.parser_digest,expectedCode);
const request={...payload,request_id:'req-a',expected_state_fingerprint:preview.state_fingerprint,expected_source_sha256:preview.source_sha256,parser_digest:preview.parser_digest,proposal_digest:preview.proposal_digest,reason:'Synthetic repair',decisions:[{amount:999}]};
const result=await sandbox.apply(request,session);assert.equal(writes,1);assert.equal(result.formal_ledger_written,false);assert.equal(lastBody.p_decisions[0].effective_mapped.amount,0,'ignore client replacement rows');
await assert.rejects(()=>sandbox.apply({...request,expected_state_fingerprint:'b'.repeat(64)},session),/预览已变化/);assert.equal(writes,1);
await assert.rejects(()=>sandbox.apply({...request,parser_digest:expectedCode+'x'},session),/指纹无效/);
allowed=false;const count=downloads;await assert.rejects(()=>sandbox.preview(payload,session),/denied/);assert.equal(downloads,count);allowed=true;
hash='b'.repeat(64);await assert.rejects(()=>sandbox.preview(payload,session),/校验失败/);hash=sourceHash;
size=4;await assert.rejects(()=>sandbox.preview(payload,session),/校验失败/);size=3;
fetchOk=false;await assert.rejects(()=>sandbox.preview(payload,session),/原件读取失败/);fetchOk=true;
const binding={expected_state_fingerprint:request.expected_state_fingerprint,expected_source_sha256:request.expected_source_sha256,parser_digest:request.parser_digest,proposal_digest:request.proposal_digest,reason:request.reason};
status={status:'committed',request_binding:binding,receipt:result};const oldDownloads=downloads;
assert.deepEqual(await sandbox.apply(request,session),result);assert.equal(downloads,oldDownloads);assert.equal(writes,1);
await assert.rejects(()=>sandbox.apply({...request,reason:'Different'},session),/REQUEST_REUSED/);
status={status:'uncertain'};await assert.rejects(()=>sandbox.apply(request,session),/状态不确定/);assert.equal(writes,1);
for(const op of ['preview','apply','status'])assert(api.includes(`operation === "history_import_reparse_${op}"`));
console.log('reparse API passed: tenant scope, source hash/size, server-only decisions, stale fingerprints, denied access, replay binding and uncertain outcomes');
