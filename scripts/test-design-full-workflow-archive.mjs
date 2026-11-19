#!/usr/bin/env node
/** Pure/in-memory synthetic archive tests. No database, migration, files, secrets or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as full from '../packages/design-production-adapter/full-workflow-archive.mjs';
import * as ui from '../packages/analysis-engine/design-pilot-ui-draft.mjs';
import * as ev from '../packages/analysis-engine/design-pilot.mjs';
import {createPreparedPrivateMedia} from '../packages/design-production-adapter/private-media.mjs';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';

globalThis.fetch=()=>{throw new Error('No network in full-workflow tests');};
const scope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
const actor={username:'synthetic-employee',store:'synthetic-store'},credential=Symbol('synthetic-session');
const uiScope={customerId:'demo-profile',visitId:'demo-visit',sessionId:'demo-ui-session'};
const evidenceScope={customerId:'11',visitId:'booking:101',sessionId:'synthetic-evidence'};
const assetId='10000000-0000-4000-8000-000000000001';
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const rehash=v=>{const {sha256,...body}=v;v.sha256=hash(body);return v;};
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
const rejectsAsync=(fn,code)=>assert.rejects(fn,e=>e.code===code);
function uiLane(){
  let state=ui.createUIDraftState(uiScope);const draft=copy(state.draft);
  draft.text=ui.UI_FIXTURE_TEXT.sample;draft.transcript=ui.UI_FIXTURE_TEXT.transcript;draft.materialRevision=1;draft.designRevision=1;
  draft.photos.before=[{id:1,kind:'demo',angle:'left'}];draft.photos.after=[{id:2,kind:'demo',angle:'right'}];draft.side.after='right';
  draft.services.perm=true;draft.services.dye=true;
  for(const placement of ['left','right']){const group=copy(ui.createUIProcessGroup('perm'));Object.assign(group.placement,{value:ui.UI_FIXTURE_TEXT[placement],original:ui.UI_FIXTURE_TEXT[placement]});Object.assign(group.rods,{value:ui.UI_FIXTURE_TEXT.rodA,original:ui.UI_FIXTURE_TEXT.rodA,confirmed:true});group.rods.tracks.actual={value:ui.UI_FIXTURE_TEXT.rodB,original:ui.UI_FIXTURE_TEXT.rodB,origin:'manual',confirmed:false,phase:'actual',edited:false};draft.zoneProcesses.top.perm.push(group);}
  const dye=copy(ui.createUIProcessGroup('dye'));Object.assign(dye.ratios,{value:ui.UI_FIXTURE_TEXT.formulaA,original:ui.UI_FIXTURE_TEXT.formulaA});draft.zoneProcesses.top.dye.push(dye);
  state=ui.saveUIDraft(state,{scope:uiScope,requestId:'ui-save-1',expectedRevision:0,draft}).uiDraft;
  state=ui.archiveUIDraft(state,{scope:uiScope,requestId:'ui-archive-1',expectedRevision:state.revision}).uiDraft;
  return {state,archives:[ui.createUIDraftArchive(state)]};
}
function append(state,event){return ev.appendDesignEvent(state,{scope:state.scope,requestId:'ev-'+(state.revision+1),expectedRevision:state.revision,event}).session;}
function phase(state,target){while(state.phase!==target)state=append(state,{type:'phase_advanced',phase:ev.DESIGN_PHASES[ev.DESIGN_PHASES.indexOf(state.phase)+1]});return state;}
function technique(id,side,value,track='planned',field='rod_size_mm',service='perm',source='speech-1',replacesEntryId=null){return {id,category:'technique',field,zone:'top',groupId:service+'-'+side,service,side,track,origin:'extraction',basis:'said',value,status:'not_confirmed',sources:[{messageId:source,quote:typeof value==='number'?String(value)+'毫米':value}],replacesEntryId};}
function evidenceLane(){
  let session=ev.createDesignSession(evidenceScope);
  session=append(session,{type:'source_recorded',source:{messageId:'speech-1',kind:'speech_transcript',actor:'employee',text:'  【合成测试】左侧计划18毫米；右侧计划20毫米；实际22毫米；配方A。\n保留原文空格。  '}});
  session=phase(session,'proposal');
  session=append(session,{type:'entry_recorded',entry:technique('left-plan','left',18)});
  session=append(session,{type:'entry_recorded',entry:technique('right-plan','right',20)});
  session=append(session,{type:'source_recorded',source:{messageId:'confirm-1',kind:'text',actor:'employee',text:'【合成测试】确认左侧计划18毫米。'}});
  session=append(session,{type:'entry_confirmed',entryId:'left-plan',confirmedValue:18,sources:[{messageId:'confirm-1',quote:'确认左侧计划18毫米'}]});
  session=append(session,{type:'entry_recorded',entry:technique('dye-left','left','配方A','planned','color_formula','dye')});
  session=phase(session,'execution');session=append(session,{type:'entry_recorded',entry:technique('left-actual','left',22,'actual')});
  session=phase(session,'archive');return {session,archives:[ev.createDesignArchive(session,evidenceScope)]};
}
function legacySnapshot(){
  const steps=Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k=>[k,'']));
  return {baseline:{outline:'合成旧档轮廓',root_flow:'',steps},optimized:{outline:'',root_flow:'',steps:copy(steps)},reasons:{outline:'',root_flow:'',...steps},execution:{},process:{proposal:'合成旧方案'},review:{},status:'baseline',photo_ids:[assetId],archive_url:null};
}
function input(){return {scope:copy(scope),store:actor.store,bindings:{uiScope:copy(uiScope),evidenceScope:copy(evidenceScope)},ui:uiLane(),evidence:evidenceLane(),legacyVersions:[{id:'20000000-0000-4000-8000-000000000001',requestId:'30000000-0000-4000-8000-000000000001',versionNumber:1,previousVersionId:null,createdAt:'2026-11-15T00:00:00Z',actor:copy(actor),scope:copy(scope),snapshot:legacySnapshot()}],photoRefs:[{kind:'legacy_asset',assetId,scope:copy(scope),store:actor.store,stage:'unknown',angle:'unknown'}]};}
function revised(initial){
  const next=copy(initial);
  let state=ui.reopenUIDraft(next.ui.state,next.ui.archives[0],{scope:uiScope,requestId:'ui-reopen',expectedRevision:next.ui.state.revision,reason:ui.UI_FIXTURE_TEXT.revisionReason}).uiDraft;
  const draft=copy(state.draft);Object.assign(draft.zoneProcesses.top.perm[0].rods,{value:ui.UI_FIXTURE_TEXT.rodB,confirmed:false,edited:true});draft.designRevision++;
  state=ui.saveUIDraft(state,{scope:uiScope,requestId:'ui-save-2',expectedRevision:state.revision,draft}).uiDraft;
  state=ui.archiveUIDraft(state,{scope:uiScope,requestId:'ui-archive-2',expectedRevision:state.revision}).uiDraft;next.ui={state,archives:[...next.ui.archives,ui.createUIDraftArchive(state)]};
  let session=ev.createDesignRevision(next.evidence.session,next.evidence.archives[0],{scope:evidenceScope,requestId:'ev-reopen',expectedRevision:next.evidence.session.revision,resumePhase:'proposal',reasonSource:{messageId:'revision-reason',kind:'text',actor:'employee',text:'【合成测试】左侧计划改为24毫米。'}}).session;
  session=append(session,{type:'entry_recorded',entry:technique('left-revised','left',24,'planned','rod_size_mm','perm','revision-reason','left-plan')});session=phase(session,'archive');next.evidence={session,archives:[...next.evidence.archives,ev.createDesignArchive(session,evidenceScope)]};
  const legacy=copy(next.legacyVersions[0]);legacy.id='20000000-0000-4000-8000-000000000002';legacy.requestId='30000000-0000-4000-8000-000000000002';legacy.versionNumber=2;legacy.previousVersionId=next.legacyVersions[0].id;legacy.snapshot.review={achieved:'合成旧档复盘'};next.legacyVersions.push(legacy);return next;
}
const sourceParts=value=>copy({ui:value.ui,evidence:value.evidence,legacyVersions:value.legacyVersions});
function fixture(original=input(),credentialValue=credential){
  const state={chains:new Map(),receipts:new Map(),active:true,actor:copy(actor),bindingRevision:'binding-v1',bindingAllowed:true,photosAllowed:true,appendCalls:0,afterAppend:()=>{},beforeCommit:()=>{},afterCommit:()=>{},ignoreHook:false,failCAS:false,verifyPhotos:async()=>true,sourcesAllowed:true,sourceSnapshots:[sourceParts(original),sourceParts(revised(original))]};let queue=Promise.resolve();
  const gate={async authorize(token,requested){assert.equal(token,credentialValue);if(!state.active)throw new Error('revoked');return {actor:copy(state.actor),scope:copy(requested)};}};
  async function transaction(context,work){
    const job=queue.then(async()=>{
      const chains=new Map([...state.chains].map(([k,v])=>[k,copy(v)])),receipts=new Map([...state.receipts].map(([k,v])=>[k,copy(v)])),key=canonical(context.scope),hooks=[];
      const tx={permissionGate:gate,
        async verifyBindings({grant,bindings}){if(!state.bindingAllowed)throw new Error('binding denied');return {scope:copy(grant.scope),store:grant.actor.store,...copy(bindings),revision:state.bindingRevision};},
        async verifyPhotoRefs(value){return state.photosAllowed&&await state.verifyPhotos(value);},
        async verifySourceSnapshots({snapshot}){return state.sourcesAllowed&&state.sourceSnapshots.some(trusted=>canonical(trusted)===canonical(sourceParts(snapshot)));},
        async readVersions(){return copy(chains.get(key)||[]);},
        async findReceipt({requestKey}){return receipts.has(requestKey)?copy(receipts.get(requestKey)):null;},
        async appendVersion({version,receipt,expectedVersion,expectedParentDigest}){const chain=chains.get(key)||[],head=chain.at(-1);if(state.failCAS||(head?.version??0)!==expectedVersion||(head?.sha256??null)!==expectedParentDigest)return false;state.appendCalls++;chain.push(copy(version));chains.set(key,chain);receipts.set(receipt.requestKey,copy(receipt));await state.afterAppend({chains,receipts});return true;},
        async beforeCommit(hook){hooks.push(hook);},
      };
      const result=await work(tx);await state.beforeCommit();if(!state.ignoreHook)for(const hook of hooks)await hook();state.chains=chains;state.receipts=receipts;await state.afterCommit();return result;
    });queue=job.catch(()=>{});return job;
  }
  const adapter=full.createPreparedFullWorkflowArchive({enabled:true,permissionGate:gate,transaction,clock:()=>1794700800000});
  const snapshot=full.createFullWorkflowSnapshot(original);
  const request=(extra={})=>({credential:credentialValue,scope:copy(scope),requestId:'full-request-1',expectedVersion:0,expectedParentDigest:null,snapshot,...extra});
  return {state,gate,transaction,adapter,snapshot,request,versions:()=>copy(state.chains.get(canonical(scope))||[])};
}

test('complete roundtrip preserves separate native representations and exact strings/confirmations',()=>{
  const original=input(),snapshot=full.createFullWorkflowSnapshot(original),decoded=full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(snapshot));
  assert.deepEqual(full.unpackFullWorkflowSnapshot(decoded),original);assert.equal(snapshot.mappingPolicy,'parallel-native-snapshots-no-inference');assert.ok(Object.isFrozen(decoded.evidence.session.entries));
  const fields=decoded.evidence.session.entries;assert.equal(fields.find(e=>e.id==='left-plan').status,'confirmed');assert.equal(fields.find(e=>e.id==='left-actual').status,'not_confirmed');assert.equal(fields.find(e=>e.id==='left-actual').value,22);
  assert.equal(decoded.ui.state.draft.zoneProcesses.top.perm[0].rods.tracks.actual.confirmed,false);assert.match(decoded.evidence.session.sources[0].text,/^  /);assert.match(decoded.evidence.session.sources[0].text,/  $/);
});
test('native indexes preserve group/service/side identity without inferring UI placement as evidence',()=>{
  const snapshot=full.createFullWorkflowSnapshot(input());const uiGroups=snapshot.index.filter(x=>x.kind==='process_group'),evidence=snapshot.index.filter(x=>x.kind==='entry');
  assert.equal(uiGroups.length,3);assert.equal(uiGroups[0].nativeIdentity.side,null);assert.equal(uiGroups[0].nativeIdentity.groupId,null);
  assert.ok(evidence.some(x=>x.nativeIdentity.side==='left'&&x.nativeIdentity.track==='actual'));assert.ok(evidence.some(x=>x.nativeIdentity.side==='right'));assert.ok(evidence.some(x=>x.nativeIdentity.service==='dye'));
  assert.ok(snapshot.index.some(x=>x.kind==='legacy_asset_reference'));assert.equal(snapshot.index.filter(x=>x.kind==='synthetic_photo_marker').length,2);
});
test('post-archive revision preserves both complete native archive chains and original confirmation',()=>{
  const first=input(),next=revised(first),snapshot=full.createFullWorkflowSnapshot(next);assert.deepEqual(full.unpackFullWorkflowSnapshot(snapshot),next);
  assert.deepEqual(snapshot.ui.archives[0],first.ui.archives[0]);assert.deepEqual(snapshot.evidence.archives[0],first.evidence.archives[0]);
  assert.equal(snapshot.evidence.session.entries.find(e=>e.id==='left-plan').status,'confirmed');assert.equal(snapshot.evidence.session.entries.find(e=>e.id==='left-revised').status,'not_confirmed');assert.equal(snapshot.legacyVersions.length,2);
});
test('synthetic UI contract is not silently widened to production data or photo bytes',()=>{
  const original=copy(input());original.ui.state.draft.text='uncontrolled real data';rejects(()=>full.createFullWorkflowSnapshot(original),'FULL_UI_INVALID');
  const x=copy(input());x.ui.state.draft.photos.before[0].url='data:image/jpeg;base64,AAAA';rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_UI_INVALID');
});
test('scopes and explicit native bindings reject collisions and cross-customer artifacts',()=>{
  for(const mutate of [x=>x.bindings.uiScope.sessionId='other',x=>x.bindings.evidenceScope.visitId='booking:102',x=>x.scope.customerProfileId='12',x=>x.legacyVersions[0].scope.visitId='booking:102',x=>x.photoRefs[0].store='other']){const x=input();mutate(x);rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_SCOPE_MISMATCH');}
});
test('missing or rewritten UI/evidence native parent archives fail closed',()=>{
  for(const lane of ['ui','evidence']){const x=revised(input());x[lane].archives.shift();rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_NATIVE_HISTORY_INCOMPLETE');}
  const x=revised(input());x.evidence.archives[0].snapshot.sources[0].text='tampered';rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_NATIVE_ARCHIVE_INVALID');
});
test('legacy chain completeness and private photo references are not silently dropped',()=>{
  const x=revised(input());x.legacyVersions.shift();rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_LEGACY_HISTORY_INCOMPLETE');
  const y=input();y.photoRefs=[];rejects(()=>full.createFullWorkflowSnapshot(y),'FULL_PHOTO_REFERENCE_MISSING');
  for(const extra of [{url:'https://example.test/private'},{bytes:'AAAA'},{signedUrl:'secret'}]){const z=input();Object.assign(z.photoRefs[0],extra);rejects(()=>full.createFullWorkflowSnapshot(z),'FULL_INVALID_FIELDS');}
});
test('unknown schema/index/digest fields are rejected, never stripped or normalized',()=>{
  const snapshot=copy(full.createFullWorkflowSnapshot(input()));snapshot.index[0].sha256='0'.repeat(64);rejects(()=>full.validateFullWorkflowSnapshot(snapshot),'FULL_SNAPSHOT_TAMPERED');
  const x=copy(full.createFullWorkflowSnapshot(input()));x.extra='dropped?';rejects(()=>full.validateFullWorkflowSnapshot(x),'FULL_INVALID_FIELDS');
  const y=copy(full.createFullWorkflowSnapshot(input()));y.schemaVersion='future';rejects(()=>full.validateFullWorkflowSnapshot(y),'FULL_SCHEMA_INVALID');
});
test('canonical codec is reversible and rejects duplicate/noncanonical or non-JSON data',()=>{
  const serialized=full.serializeFullWorkflowSnapshot(full.createFullWorkflowSnapshot(input()));rejects(()=>full.parseFullWorkflowSnapshot(' '+serialized),'FULL_NONCANONICAL_SERIALIZATION');
  const bad=input();bad.bad=undefined;rejects(()=>full.createFullWorkflowSnapshot(bad),'FULL_INVALID_JSON');
  const other=input();Object.defineProperty(other,'hidden',{value:'secret',enumerable:false});rejects(()=>full.createFullWorkflowSnapshot(other),'FULL_INVALID_JSON');
  const getter=input();Object.defineProperty(getter,'hidden',{get(){throw new Error('must not run');},enumerable:true});rejects(()=>full.createFullWorkflowSnapshot(getter),'FULL_INVALID_JSON');
  const large=input();large.extra='x'.repeat(full.FULL_WORKFLOW_MAX_BYTES);rejects(()=>full.createFullWorkflowSnapshot(large),'FULL_TOO_LARGE');
});
test('disabled or unconfigured transaction boundary performs no writes',async()=>{
  const h=fixture();await rejectsAsync(full.createPreparedFullWorkflowArchive().append(h.request()),'FULL_DISABLED');await rejectsAsync(full.createPreparedFullWorkflowArchive({enabled:true}).append(h.request()),'FULL_NOT_CONFIGURED');assert.equal(h.versions().length,0);
});
test('first full append stores whole artifact separately from unchanged legacy native versions',async()=>{
  const h=fixture(),result=await h.adapter.append(h.request());assert.equal(result.saved,true);assert.equal(result.replayed,false);assert.equal(result.version.version,1);assert.equal(result.version.previous,null);assert.deepEqual(result.version.snapshot,h.snapshot);
  assert.deepEqual(full.validateFullWorkflowChain(h.versions(),scope),h.versions());assert.equal(h.versions()[0].snapshot.legacyVersions[0].snapshot.process.proposal,'合成旧方案');
});
test('full second version links parent digest and preserves every original archive byte value',async()=>{
  const original=input(),h=fixture(original),first=await h.adapter.append(h.request()),old=canonical(h.versions()[0]);
  const second=await h.adapter.append(h.request({requestId:'full-request-2',expectedVersion:1,expectedParentDigest:first.version.sha256,snapshot:full.createFullWorkflowSnapshot(revised(original))}));
  assert.equal(second.version.version,2);assert.deepEqual(second.version.previous,{version:1,sha256:first.version.sha256});assert.equal(canonical(h.versions()[0]),old);assert.equal(full.validateFullWorkflowChain(h.versions(),scope).length,2);
});
test('same request is idempotent even after newer version; changed request payload conflicts',async()=>{
  const original=input(),h=fixture(original),first=await h.adapter.append(h.request());await h.adapter.append(h.request({requestId:'full-request-2',expectedVersion:1,expectedParentDigest:first.version.sha256,snapshot:full.createFullWorkflowSnapshot(revised(original))}));
  const replay=await h.adapter.append(h.request());assert.equal(replay.replayed,true);assert.equal(replay.appliedVersion,1);assert.equal(replay.observedHeadVersion,2);assert.equal(h.state.appendCalls,2);
  await rejectsAsync(h.adapter.append(h.request({snapshot:full.createFullWorkflowSnapshot(revised(original))})),'FULL_REQUEST_CONFLICT');
});
test('concurrent stale appends use real expected-version/parent CAS with one winner',async()=>{
  const h=fixture();const results=await Promise.allSettled([h.adapter.append(h.request()),h.adapter.append(h.request({requestId:'concurrent'}))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'FULL_VERSION_CONFLICT');assert.equal(h.versions().length,1);
});
test('wrong parent digest or missing history cannot replace earlier native versions',async()=>{
  const original=input(),h=fixture(original),first=await h.adapter.append(h.request());await rejectsAsync(h.adapter.append(h.request({requestId:'next',expectedVersion:1,expectedParentDigest:'0'.repeat(64)})),'FULL_VERSION_CONFLICT');
  const altered=input();altered.evidence=null;altered.bindings.evidenceScope=null;h.state.sourceSnapshots.push(sourceParts(altered));await rejectsAsync(h.adapter.append(h.request({requestId:'drop',expectedVersion:1,expectedParentDigest:first.version.sha256,snapshot:full.createFullWorkflowSnapshot(altered)})),'FULL_HISTORY_REWRITE');assert.equal(h.versions().length,1);
});
test('authoritative binding and photo ownership rejection prevent new writes and replay delivery',async()=>{
  for(const flag of ['bindingAllowed','photosAllowed']){const h=fixture();h.state[flag]=false;await rejectsAsync(h.adapter.append(h.request()),'FULL_BINDING_DENIED');assert.equal(h.versions().length,0);h.state[flag]=true;await h.adapter.append(h.request());h.state[flag]=false;await rejectsAsync(h.adapter.append(h.request()),'FULL_BINDING_DENIED');assert.equal(h.versions().length,1);}
});
test('late permission revocation and binding change roll back full append plus receipt',async()=>{
  for(const change of ['revoke','binding']){const h=fixture();h.state.beforeCommit=()=>{if(change==='revoke')h.state.active=false;else h.state.bindingRevision='changed';};await rejectsAsync(h.adapter.append(h.request()),change==='revoke'?'FULL_ACCESS_DENIED':'FULL_AUTHORIZATION_CHANGED');assert.equal(h.versions().length,0);assert.equal(h.state.receipts.size,0);}
});
test('same receipt request key cannot be replayed under another customer scope',async()=>{
  const h=fixture();await h.adapter.append(h.request());const next=input();next.scope={...scope,customerProfileId:'12'};next.evidence=null;next.bindings.evidenceScope=null;next.legacyVersions=[];next.photoRefs=[];h.state.sourceSnapshots.push(sourceParts(next));
  await rejectsAsync(h.adapter.append(h.request({scope:next.scope,snapshot:full.createFullWorkflowSnapshot(next)})),'FULL_REQUEST_CONFLICT');assert.equal(h.versions().length,1);
});
test('receipt corruption and omitted receipt are fail-closed, not duplicate archive writes',async()=>{
  for(const alter of [s=>s.receipts.clear(),s=>{const r=s.receipts.values().next().value;r.sha256='0'.repeat(64);},s=>{const r=s.receipts.values().next().value;r.scope.visitId='booking:999';}]){const h=fixture();await h.adapter.append(h.request());alter(h.state);await assert.rejects(h.adapter.append(h.request()),e=>['FULL_RECEIPT_INVALID','FULL_REQUEST_CONFLICT'].includes(e.code));assert.equal(h.versions().length,1);assert.equal(h.state.appendCalls,1);}
});
test('unknown commit acknowledgement retains exact request for idempotent recovery',async()=>{
  const h=fixture();h.state.afterCommit=()=>{throw new Error('lost acknowledgement');};await rejectsAsync(h.adapter.append(h.request()),'FULL_OUTCOME_UNCERTAIN');assert.equal(h.versions().length,1);h.state.afterCommit=()=>{};const replay=await h.adapter.append(h.request());assert.equal(replay.replayed,true);assert.equal(h.state.appendCalls,1);
});
test('transaction without executing final guard is never reported successful',async()=>{
  const h=fixture();h.state.ignoreHook=true;await rejectsAsync(h.adapter.append(h.request()),'FULL_OUTCOME_UNCERTAIN');
});
test('corrupted version parent or rewritten history is detected even when envelope hash is recomputed',async()=>{
  const original=input(),h=fixture(original),first=await h.adapter.append(h.request());await h.adapter.append(h.request({requestId:'next',expectedVersion:1,expectedParentDigest:first.version.sha256,snapshot:full.createFullWorkflowSnapshot(revised(original))}));
  const chain=h.versions();chain[1].previous.sha256='0'.repeat(64);rehash(chain[1]);rejects(()=>full.validateFullWorkflowChain(chain,scope),'FULL_PARENT_MISMATCH');
  const changed=h.versions(),rewritten=JSON.parse(JSON.stringify(input()).replaceAll('保留原文空格','改写原始内容'));changed[1].snapshot=full.createFullWorkflowSnapshot(rewritten);rehash(changed[1]);
  rejects(()=>full.validateFullWorkflowChain(changed,scope),'FULL_HISTORY_REWRITE');
});


test('transaction return followed by revocation reports uncertainty without disclosing the committed snapshot',async()=>{
  const h=fixture();h.state.afterCommit=()=>{h.state.active=false;};await assert.rejects(h.adapter.append(h.request()),e=>e.code==='FULL_OUTCOME_UNCERTAIN'&&e.outcome==='uncertain'&&e.retryable===false&&!JSON.stringify(e).includes('snapshot'));
  assert.equal(h.versions().length,1);h.state.active=true;h.state.afterCommit=()=>{};const replay=await h.adapter.append(h.request());assert.equal(replay.replayed,true);assert.equal(h.state.appendCalls,1);
});
test('total chain byte budget rejects oversized aggregate before per-version copies or validation',()=>{
  const chunk='x'.repeat(65536),oversized=Array.from({length:100},()=>({extra:Array(11).fill(chunk)}));
  rejects(()=>full.validateFullWorkflowChain(oversized,scope),'FULL_TOO_LARGE');
});
test('explicit v1-to-v2 migration retains original v1 archive shape and complete migration checkpoint',()=>{
  let old=copy(ev.createDesignSession(evidenceScope));old.schemaVersion=ev.LEGACY_DESIGN_SCHEMA_VERSION;
  old=append(old,{type:'source_recorded',source:{messageId:'old-raw',kind:'text',actor:'employee',text:'【合成测试】原始v1资料。'}});old=phase(old,'archive');const archive=ev.createDesignArchive(old,evidenceScope),oldBytes=canonical(archive);
  const x=input();x.evidence={session:old,archives:[archive]};rejects(()=>full.createFullWorkflowSnapshot(x),'FULL_EXPLICIT_MIGRATION_REQUIRED');
  const session=ev.migrateDesignSession(old,{scope:evidenceScope,requestId:'explicit-migration',expectedRevision:old.revision}).session;
  x.evidence={session,archives:[archive,ev.createDesignArchive(session,evidenceScope)]};const restored=full.unpackFullWorkflowSnapshot(full.createFullWorkflowSnapshot(x));
  assert.equal(canonical(restored.evidence.archives[0]),oldBytes);assert.equal(Object.hasOwn(restored.evidence.archives[0],'previousArchiveRevision'),false);assert.deepEqual(restored.evidence.session.journal.slice(0,old.revision),old.journal);
});
test('all 96 UI process groups and their separate records survive full-workflow serialization',()=>{
  const x=input();let state=ui.createUIDraftState(uiScope),draft=copy(state.draft);draft.designRevision=1;
  for(const zone of ui.UI_ZONES)for(const service of ['perm','dye'])for(let i=0;i<8;i++){
    const group=copy(ui.createUIProcessGroup(service));Object.assign(group.placement,{value:ui.UI_FIXTURE_TEXT[i%2?'left':'right'],original:ui.UI_FIXTURE_TEXT[i%2?'left':'right']});
    if(service==='perm'){Object.assign(group.rods,{value:ui.UI_FIXTURE_TEXT.rodA,original:ui.UI_FIXTURE_TEXT.rodA,confirmed:true});group.rods.tracks.actual={value:ui.UI_FIXTURE_TEXT.rodB,original:ui.UI_FIXTURE_TEXT.rodB,origin:'manual',phase:'actual',confirmed:false,edited:false};}
    draft.zoneProcesses[zone][service].push(group);
  }
  state=ui.saveUIDraft(state,{scope:uiScope,requestId:'all-groups',expectedRevision:0,draft}).uiDraft;state=ui.archiveUIDraft(state,{scope:uiScope,requestId:'all-groups-archive',expectedRevision:state.revision}).uiDraft;
  x.ui={state,archives:[ui.createUIDraftArchive(state)]};const snapshot=full.createFullWorkflowSnapshot(x),restored=full.unpackFullWorkflowSnapshot(full.parseFullWorkflowSnapshot(full.serializeFullWorkflowSnapshot(snapshot)));
  assert.equal(snapshot.index.filter(row=>row.kind==='process_group').length,96);assert.deepEqual(restored,x);
});
test('actual private-media reference composition preserves opaque ID, reference/detail and complete metadata',async()=>{
  const h=fixture(),mediaId='opaque_ref-A',record={mediaId,requestId:mediaId,binding:{owner:actor.username,store:actor.store,scope:copy(scope)},stage:'reference',angle:'detail',mime:'image/png',byteLength:1234,width:320,height:240,sha256:'0'.repeat(64),active:true};
  const privateMedia=createPreparedPrivateMedia({enabled:true,permissionGate:h.gate,privateStorageOrigin:'https://synthetic-storage.invalid',approvalVerifier:{verify:async()=>true},imageInspector:async()=>{throw new Error('reference resolution must not decode');},repository:{withScopeLock:async(binding,work)=>{assert.deepEqual(binding,record.binding);return work({readRecord:async id=>id===mediaId?copy(record):null,readBytes:async()=>{throw new Error('no byte reads');},insertImmutable:async()=>{throw new Error('no upload');},beforeCommit:async()=>{}});}}});
  const resolved=await privateMedia.resolveReferences({credential,scope,approval:{synthetic:true},mediaIds:[mediaId]});
  const x=input();x.photoRefs.push({kind:'private_media',scope:copy(scope),store:actor.store,reference:resolved.references[0]});
  h.state.verifyPhotos=async({grant,photoRefs})=>photoRefs.every(photo=>photo.kind==='legacy_asset'||record.active&&record.binding.owner===grant.actor.username&&sameRecordBinding(record.binding,grant)&&sameReference(photo.reference,resolved.references[0]));
  const snapshot=full.createFullWorkflowSnapshot(x),result=await h.adapter.append(h.request({snapshot}));
  assert.deepEqual(result.version.snapshot.photoRefs[1].reference,resolved.references[0]);assert.equal(result.version.snapshot.photoRefs[1].reference.angle,'detail');assert.equal(result.version.snapshot.photoRefs[1].reference.stage,'reference');
  record.active=false;await rejectsAsync(h.adapter.append(h.request({snapshot})),'FULL_BINDING_DENIED');assert.equal(h.versions().length,1);
  function sameRecordBinding(binding,grant){return binding.store===grant.actor.store&&canonical(binding.scope)===canonical(grant.scope);}
  function sameReference(a,b){return canonical(a)===canonical(b);}
});
test('actual HTTP full-archive route composes with immutable transaction adapter, replay and scope denial',async()=>{
  const token='synthetic-http-session',h=fixture(input(),token),api='https://synthetic-api.invalid',origin='https://synthetic-app.invalid';
  const handler=createDesignHttpHandler({enabled:true,publicOrigin:api,allowedRequestOrigins:[origin],employeeAdapter:{authenticate:async value=>{assert.equal(value,token);if(!h.state.active)throw new Error('revoked');return {...actor,active:true,expiresAt:9999999999999};},gate:h.gate},fullWorkflowArchive:h.adapter});
  const send=async extra=>{const {credential,...body}=h.request(extra);return handler(new Request(api+'/api/design/archive/full',{method:'POST',headers:{'content-type':'application/json',origin,'x-employee-session':token},body:JSON.stringify(body)}));};
  const first=await send();assert.equal(first.status,200);const result=await first.json();assert.equal(result.result.appliedVersion,1);assert.deepEqual(result.result.version.snapshot,h.snapshot);assert.equal(first.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(result).includes(token));
  const replay=await send();assert.equal(replay.status,200);assert.equal((await replay.json()).result.replayed,true);assert.equal(h.state.appendCalls,1);
  const denied=await send({scope:{...scope,visitId:'booking:999'}});assert.ok(denied.status>=400);assert.equal(h.versions().length,1);
  h.state.afterCommit=()=>{h.state.active=false;};const uncertain=await send();assert.ok(uncertain.status>=400);const failure=await uncertain.json();assert.equal(failure.ok,false);assert.equal(failure.error.code,'FULL_OUTCOME_UNCERTAIN');assert.equal(failure.error.outcome,'uncertain');
});


test('a consistent snapshot/hash is not source authority; repository verification is mandatory for write and replay',async()=>{
  const h=fixture();h.state.sourcesAllowed=false;await rejectsAsync(h.adapter.append(h.request()),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(h.versions().length,0);
  h.state.sourcesAllowed=true;await h.adapter.append(h.request());h.state.sourcesAllowed=false;await rejectsAsync(h.adapter.append(h.request()),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(h.versions().length,1);assert.equal(h.state.appendCalls,1);
  const missing=fixture();const adapter=full.createPreparedFullWorkflowArchive({enabled:true,permissionGate:missing.gate,transaction:(context,work)=>missing.transaction(context,tx=>{delete tx.verifySourceSnapshots;return work(tx);})});
  await rejectsAsync(adapter.append(missing.request()),'FULL_NOT_CONFIGURED');assert.equal(missing.versions().length,0);
});
test('source authority revoked at final commit guard rolls back both archive and receipt',async()=>{
  const h=fixture();h.state.beforeCommit=()=>{h.state.sourcesAllowed=false;};await rejectsAsync(h.adapter.append(h.request()),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(h.versions().length,0);assert.equal(h.state.receipts.size,0);
});


test('self-consistent forged source and confirmation hashes cannot replace trusted native snapshots',async()=>{
  for(const change of ['source','legacy-confirmation']){
    const h=fixture();let forged=copy(input());
    if(change==='source')forged=JSON.parse(JSON.stringify(forged).replaceAll('保留原文空格','伪造原话内容'));
    else forged.legacyVersions[0].snapshot.status='confirmed';
    const snapshot=full.createFullWorkflowSnapshot(forged);assert.doesNotThrow(()=>full.validateFullWorkflowSnapshot(snapshot));assert.notEqual(snapshot.sha256,h.snapshot.sha256);
    await rejectsAsync(h.adapter.append(h.request({snapshot})),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(h.versions().length,0);assert.equal(h.state.receipts.size,0);
  }
});
test('incomplete authoritative native-store history rejects an otherwise self-consistent full snapshot',async()=>{
  const h=fixture();h.state.sourceSnapshots=h.state.sourceSnapshots.map(trusted=>{const partial=copy(trusted);partial.evidence.archives.shift();return partial;});
  assert.doesNotThrow(()=>full.validateFullWorkflowSnapshot(h.snapshot));await rejectsAsync(h.adapter.append(h.request()),'FULL_SOURCE_SNAPSHOT_DENIED');assert.equal(h.versions().length,0);
});
