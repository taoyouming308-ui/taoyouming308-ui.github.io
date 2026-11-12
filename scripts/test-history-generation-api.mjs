import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const source=api.slice(api.indexOf('const HISTORY_REPARSE_CODE_DIGEST ='),api.indexOf('\nasync function historyImportPreview('));
let allowed=true;const calls=[];
const sandbox={
  historyImportFinance:()=>{if(!allowed)throw Error('denied');},
  selectedStoreInfo:async()=>({company_id:'company-a',id:'store-a'}),
  uuidValue:v=>{if(!v)throw Error('id required');return v;},
  cleanText:(v,max=500)=>String(v??'').trim().slice(0,max),
  rpcSaved:async(path,body)=>{calls.push({path,body});return {status:'synthetic',formal_ledger_written:path.endsWith('_post')};},
};
vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(source+'\nthis.action=historyImportGenerationAction;this.amend=historyImportGenerationAmend;this.state=historyImportGenerationStatus;this.status=historyImportGenerationRequestStatus;'),sandbox);
const hash='a'.repeat(64),session={auth_account_id:'actor-a'};
const payload={import_batch_id:'batch-a',generation_id:'generation-a',generation_version:1,expected_state_fingerprint:hash,request_id:'request-a',reason:'Reviewed synthetic source',acknowledged_issue_digest:hash,expected_review_fingerprint:hash,expected_confirmation_id:'confirmation-a',financial_acceptance:true,confirm_formal_post:true,amount:999,decisions:[{amount:999}],p_actor_user_id:'evil',p_store_id:'evil'};
await sandbox.action(payload,session,'review');assert.equal(calls.length,1);assert.equal(calls[0].path,'rpc/zysyr_history_generation_review');
assert.equal(calls[0].body.p_actor_user_id,'actor-a');assert.equal(calls[0].body.p_store_id,'store-a');
assert.equal(calls[0].body.p_expected_generation_id,'generation-a');assert.equal(calls[0].body.p_expected_generation_version,1);
assert.equal('amount' in calls[0].body,false);assert.equal('decisions' in calls[0].body,false);assert.equal('p_confirm_formal_post' in calls[0].body,false);
await sandbox.action(payload,session,'confirm');assert.equal(calls.length,2);assert.equal(calls[1].path,'rpc/zysyr_history_generation_confirm');
await sandbox.action(payload,session,'post');assert.equal(calls.length,3);assert.equal(calls[2].path,'rpc/zysyr_history_generation_post');
for(const [delta,action] of [[{generation_version:0},'review'],[{generation_version:1.5},'review'],[{expected_state_fingerprint:hash+'x'},'review'],[{acknowledged_issue_digest:''},'review'],[{reason:''},'review'],[{financial_acceptance:false},'confirm'],[{financial_acceptance:'true'},'confirm'],[{confirm_formal_post:false},'post'],[{expected_confirmation_id:''},'post']])await assert.rejects(()=>sandbox.action({...payload,...delta},session,action));
assert.equal(calls.length,3,'invalid actions must not call any RPC');
allowed=false;await assert.rejects(()=>sandbox.action(payload,session,'post'),/denied/);assert.equal(calls.length,3);allowed=true;
await sandbox.state(payload,session);assert.equal(calls.at(-1).path,'rpc/zysyr_history_generation_finance_state');
await sandbox.status(payload,session);assert.equal(calls.at(-1).path,'rpc/zysyr_history_generation_finance_status');assert.equal(calls.at(-1).body.p_request_id,'request-a');
console.log('generation finance API passed: trusted scope, exact version/fingerprints, explicit separate acceptance/post, no client amounts and request status');

const amendment={...payload,ledger_entry_id:'ledger-a',expected_ledger_version:2,current_payload:{amount:123},confirm_reverse:true};
await sandbox.amend(amendment,session,'revise');assert.equal(calls.at(-1).path,'rpc/zysyr_history_generation_revise');assert.equal(calls.at(-1).body.p_expected_ledger_version,2);assert.equal(calls.at(-1).body.p_current_payload.amount,123);assert.equal(calls.at(-1).body.p_actor_user_id,'actor-a');assert.equal(calls.at(-1).body.p_store_id,'store-a');assert.equal('p_confirm_reverse' in calls.at(-1).body,false);
await sandbox.amend(amendment,session,'reverse');assert.equal(calls.at(-1).path,'rpc/zysyr_history_generation_reverse');assert.equal(calls.at(-1).body.p_confirm_reverse,true);assert.equal('p_current_payload' in calls.at(-1).body,false);
const callCount=calls.length;
for(const [delta,action] of [[{expected_ledger_version:0},'revise'],[{ledger_entry_id:''},'revise'],[{current_payload:null},'revise'],[{current_payload:[]},'revise'],[{confirm_reverse:false},'reverse'],[{confirm_reverse:'true'},'reverse'],[{reason:''},'reverse']])await assert.rejects(()=>sandbox.amend({...amendment,...delta},session,action));
assert.equal(calls.length,callCount);allowed=false;await assert.rejects(()=>sandbox.amend(amendment,session,'revise'),/denied/);assert.equal(calls.length,callCount);
console.log('generation amendment API passed: ledger version/state binding, explicit reverse, scoped trusted actor and no implicit source changes');
