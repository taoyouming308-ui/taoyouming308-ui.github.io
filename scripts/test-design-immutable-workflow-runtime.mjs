import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';
import {createImmutableWorkflowRepository,validateAuthorizedWorkflowBundle} from '../packages/design-production-adapter/immutable-workflow-repository.mjs';
import {createImmutableWorkflowRuntime} from '../packages/design-production-adapter/immutable-workflow-runtime.mjs';
import {createPreparedWorkflowService} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {policyDigest as hash} from '../packages/design-production-adapter/approval-attempt-contracts.mjs';
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},token='SYNTHETIC_WORKFLOW_SESSION_01234567890';
const authority={schemaVersion:'design-immutable-authority-v1',subjectId:'subject-a',employmentId:'employment-a',membershipId:'membership-a',securityEpoch:1,membershipRevision:1,storeId:'store-a',actor:{username:'alice',store:'自由手艺人'},scope,bindingRevision:'1'};
const clone=structuredClone;
function fixture(){
 const state={authority:clone(authority),rows:[],receipts:[],authors:[],manifest:null,queries:[],commits:0,failCommit:false,hook:null};
 const bundle=s=>({schemaVersion:'design-authorized-workflow-bundle-v1',authority:clone(state.authority),manifest:clone(s.manifest),sourceFingerprint:hash(s.rows),workflowRows:clone(s.rows),workflowReceipts:clone(s.receipts),legacyVersions:[],legacyPhotos:[],fullRows:[],fullReceipts:[],mediaRows:[],candidateRows:[],operationAuthors:clone(s.authors)});
 const acquireClient=async()=>{let pending;return {async query(sql,params=[]){state.queries.push(sql);if(state.hook)await state.hook(sql,params);
  const row=(key,value)=>({command:'SELECT',rowCount:1,rows:[{[key]:clone(value)}]});
  if(sql.startsWith('BEGIN')){pending=clone({rows:state.rows,receipts:state.receipts,authors:state.authors,manifest:state.manifest});return {command:'BEGIN',rowCount:null,rows:[]};}
  if(sql==='COMMIT'){Object.assign(state,pending);state.commits++;if(state.failCommit){state.failCommit=false;throw Error('SYNTHETIC_ACK_LOST');}return {command:'COMMIT',rowCount:null,rows:[]};}
  if(sql==='ROLLBACK')return {command:'ROLLBACK',rowCount:null,rows:[]};
  if(sql.startsWith('SET '))return {command:'SET',rowCount:null,rows:[]};
  if(sql.includes('pg_advisory_xact_lock'))return row('locked','');
  if(sql.includes('design_key_private.authenticate')||sql.includes('design_key_private.recheck_identity'))return row('value',{schemaVersion:'design-key-identity-v2',...Object.fromEntries(['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision'].map(k=>[k,state.authority[k]])),expiresAt:Date.now()+60000});
  if(sql.includes('design_key_private.clear_context'))return row('value','');
  if(sql.includes('design_identity.authorize')){assert.equal(params[0],token);assert.deepEqual(params[1],scope);return row('authority',state.authority);}
  if(sql.includes('design_identity.recheck_authority'))return row('authority',state.authority);
  if(sql.includes('design_identity.clear_context'))return row('cleared','');
  if(sql.includes('read_bundle'))return row('value',bundle(pending));
  if(sql.includes('initialize_native')||sql.includes('append_native')){const q=params[0],prior=pending.rows.at(-1);assert.equal(q.expectedSourceFingerprint,hash(pending.rows));if(prior)assert.equal(prior.revision,q.expectedRevision);assert.equal(hash(q.record),q.recordSha256);
   pending.rows.push({revision:q.record.revision,record:clone(q.record),sha256:q.recordSha256,previous_sha256:prior?.sha256??null,receipt_key:q.receiptKey??null});
   if(q.receipt)pending.receipts.push({request_key:q.receiptKey,receipt:clone(q.receipt),record_sha256:q.recordSha256});
   pending.authors.push({revision:q.record.revision,receiptKey:q.receiptKey??null,authority:clone(state.authority),recordSha256:q.recordSha256,previousSha256:prior?.sha256??null,manifestId:pending.manifest?.id??null});return row('value',true);}
  throw Error('UNEXPECTED_FIXED_QUERY');
 },async release(){}};};
 const bridge=createImmutableWorkflowRepository({enabled:true,acquireClient}),service=createPreparedWorkflowService({enabled:true,permissionGate:bridge.permissionGate,repository:bridge.repository});
 const run=work=>bridge.runRequest({credential:token,scope},work);
 const load=()=>run(async()=>{await bridge.initialize();return service.load({credential:token,scope});});
 const request=(id,revision,text='合成设计原话')=>({credential:token,scope,requestId:id,expectedRevision:revision,intent:{type:'record_source',kind:'text',text}});
 const dispatch=r=>run(()=>service.dispatch(r));
 return {state,bundle:()=>bundle(state),acquireClient,bridge,service,run,load,request,dispatch};
}
test('default and unscoped repository deny without driver access',async()=>{let n=0;const x=createImmutableWorkflowRepository({acquireClient:()=>n++});await assert.rejects(x.runRequest({credential:token,scope},()=>{}));const f=fixture();await assert.rejects(f.bridge.initialize());assert.equal(n,0);assert.equal(f.state.queries.length,0);});
test('actual original service initializes, appends native source, and exact replays without append',async()=>{const f=fixture();assert.equal((await f.load()).record.revision,0);const r=f.request('first',0);assert.equal((await f.dispatch(r)).record.revision,1);assert.equal((await f.dispatch(r)).replayed,true);assert.equal(f.state.rows.length,2);assert.equal(f.state.authors[1].authority.subjectId,authority.subjectId);assert.deepEqual((await f.load()).record,f.state.rows[1].record);});
test('independent manifest grants old prefix access without claiming its old authors; new suffix uses current tuple',async()=>{const f=fixture();await f.load();await f.dispatch(f.request('old',0));const old=f.state.receipts[0];old.receipt.actor.username='historic-person';old.request_key=hash([old.receipt.actor,old.receipt.request.requestId]);f.state.rows[1].receipt_key=old.request_key;f.state.authors=[];
 await assert.rejects(f.load());f.state.manifest={id:'manifest-a',revision:1,reader:clone(authority),baseWorkflowRevision:1,baseWorkflowSha256:f.state.rows[1].sha256,sourceFingerprint:hash(f.state.rows),expiresAt:Date.now()+60000};const before=clone(f.state.rows);await f.load();await f.dispatch(f.request('new',1));assert.deepEqual(f.state.rows.slice(0,2),before);assert.equal(f.state.authors[0].revision,2);assert.equal(f.state.receipts[0].receipt.actor.username,'historic-person');});
test('same alias with changed immutable epoch during one request cannot pass post-commit identity checks',async()=>{const f=fixture();await f.load();let n=0;f.state.hook=async sql=>{if(sql.includes('design_identity.authorize')&&++n===3)f.state.authority.securityEpoch++;};await assert.rejects(f.dispatch(f.request('changed',0)));});
test('bundle rejects receipt/hash/replay changes and unsupported private dependencies',async()=>{const f=fixture();await f.load();await f.dispatch(f.request('first',0));for(const mutate of [b=>b.workflowRows[1].sha256='0'.repeat(64),b=>b.workflowReceipts[0].receipt.request.intent.text='forged',b=>b.mediaRows.push({}),b=>b.operationAuthors[1].authority.subjectId='another']){const b=f.bundle();mutate(b);assert.throws(()=>validateAuthorizedWorkflowBundle(b,authority));}});
test('getter/proxy bundle data is refused without invoking user code',()=>{let invoked=0;const b={};Object.defineProperty(b,'schemaVersion',{enumerable:true,get(){invoked++;return 'x';}});assert.throws(()=>validateAuthorizedWorkflowBundle(b,authority));assert.throws(()=>validateAuthorizedWorkflowBundle(new Proxy({},{}),authority));assert.equal(invoked,0);});
test('lost commit acknowledgement remains uncertain; persisted native write cannot be silently repeated',async()=>{const f=fixture();await f.load();f.state.hook=async sql=>{if(sql.includes('append_native'))f.state.failCommit=true;};await assert.rejects(f.dispatch(f.request('lost',0)));assert.equal(f.state.rows.length,2);f.state.hook=null;assert.equal((await f.dispatch(f.request('lost',0))).replayed,true);assert.equal(f.state.rows.length,2);});
test('nested request contexts and escaped transaction access refuse reuse',async()=>{const f=fixture();await assert.rejects(f.run(()=>f.run(()=>{})));await f.load();await assert.rejects(f.bridge.permissionGate.authorize(token,scope));});
test('HTTP composition reuses old native response; all missing capability route graphs stay closed',async()=>{const f=fixture(),api='https://synthetic-workflow.invalid',origin='https://synthetic-app.invalid',runtime=createImmutableWorkflowRuntime({enabled:true,acquireClient:f.acquireClient,publicOrigin:api,allowedRequestOrigins:[origin]});const req=(path,body)=>new Request(api+path,{method:'POST',headers:{origin,'content-type':'application/json','x-employee-session':token},body:JSON.stringify(body)});
 let response=await runtime.handle(req('/api/design/workflow/load',{scope}));assert.equal(response.status,200,await response.clone().text());response=await runtime.handle(req('/api/design/workflow/dispatch',{scope,requestId:'http',expectedRevision:0,intent:{type:'record_source',kind:'text',text:'合成HTTP'}}));assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).result.record.revision,1);
 for(const path of ['/api/design/archive/full','/api/design/media/upload','/api/design/candidate/extract','/api/design/visit/list'])assert.equal((await runtime.handle(req(path,{}))).status,404);
 response=await runtime.handle(req('/api/design/workflow/dispatch',{scope,requestId:'media',expectedRevision:1,intent:{type:'attach_media',mediaIds:['x']}}));assert.notEqual(response.status,200);assert.equal(f.state.rows.length,2);
});

test('full snapshots cannot smuggle media dependencies into the text-only route graph',async()=>{const f=fixture();await f.load();const b=f.bundle();b.manifest={id:'manifest',revision:1,reader:clone(authority),baseWorkflowRevision:0,baseWorkflowSha256:b.workflowRows[0].sha256,sourceFingerprint:b.sourceFingerprint,expiresAt:Date.now()+60000};b.fullRows=[{version:1,record:{version:1,sha256:'a'.repeat(64),snapshot:{photoRefs:[{}]}},sha256:'a'.repeat(64)}];b.fullReceipts=[{}];assert.throws(()=>validateAuthorizedWorkflowBundle(b,authority),e=>e.code==='IMMUTABLE_WORKFLOW_DEPENDENCY_UNSUPPORTED');});

test('new SQL fixtures do not repeat extraction-before-subtraction precedence bug',()=>{for(const file of ['stage16-workflow-authority-fixture.sql','stage16-artifact-renewal-fixture.sql'])assert.doesNotMatch(readFileSync(new URL('../packages/design-production-adapter/drafts/'+file,import.meta.url),'utf8'),/->\s*'[^']+'\s*-(?!>)/i);});
