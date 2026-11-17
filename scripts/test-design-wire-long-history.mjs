/** Bounded Stage22 workload, normal immutable HTTP operations and actual pg wire.
 * Fixed 16/24/32 native checkpoints, no arbitrary stress count, default client 30s.
 * Original psql helpers are independent synthetic issuers/setup only.
 */
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {createWireRequestMetrics} from './fixtures/design-wire-request-metrics.mjs';
import {createImmutableCandidateWireFixture} from './fixtures/design-immutable-candidate-wire-fixture.mjs';
import {createImmutableGenerationRuntime} from '../packages/design-production-adapter/immutable-generation-runtime.mjs';
import {createPreparedHttpClient} from '../packages/design-prepared-ui/http-client.mjs';
import {createDependencyAuthorityCapabilities} from '../packages/design-production-adapter/dependency-authority-capabilities.mjs';
import {validateAuthorizedDependencyBundle} from '../packages/design-production-adapter/immutable-dependency-repository.mjs';
import {DESIGN_COMPARISON_CHANGES} from '../packages/analysis-engine/design-candidate.mjs';
import {STAGE18_SYNTHETIC_KEY} from './fixtures/design-immutable-provider-fixture.mjs';

globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const proofReadsEnabled=process.argv.includes('--proof-reads');
const stage=proofReadsEnabled?'STAGE23':'STAGE22';
const evidenceDirectory=new URL('../'+(proofReadsEnabled?'../ai-design-pilot-evidence/stage23/':'../ai-design-pilot-evidence/stage22/'),import.meta.url);
mkdirSync(evidenceDirectory,{recursive:true,mode:0o700});
const requestMetrics=createWireRequestMetrics({onReport:event=>console.log(stage+'_LONG_HTTP '+JSON.stringify(event))});
const f=await createImmutableCandidateWireFixture({canonicalLeaves:true,queryObserver:requestMetrics.observeQuery});
if(proofReadsEnabled){try{f.sqlAdmin(readFileSync(new URL('../packages/design-production-adapter/drafts/stage23-dependency-proof-fixture.sql',import.meta.url),'utf8'));}catch(error){await f.cleanup();throw error;}}
const origin='https://wire-history.synthetic.invalid',scope=f.scopeA,inflight=new Set();
let serial=0,providerCalls=0,keyOpens=0,head,bundleCaptured=false,lastSynthesisAttempt=null;
const phaseCounts=new Map();
const config={enabled:true,proofReadsEnabled,acquireClient:f.acquire,publicOrigin:origin,allowedRequestOrigins:[origin],media:f.mediaConfig,generation:{enabled:true,visualEnabled:true,synthesisEnabled:true,modelConfig:f.modelConfig,approvedTextModels:[f.modelConfig.model],approvedVisionModels:[f.modelConfig.model],sealer:{...f.sealer,async open(...args){keyOpens++;requestMetrics.noteCall('key');f.noOpenTx();return f.sealer.open(...args);}},derivativeProvider:f.derivativeProvider,derivativeInspector:f.derivativeInspector,transport:async req=>{providerCalls++;requestMetrics.noteCall('provider');f.noOpenTx();assert.equal(req.headers.Authorization,'Bearer '+STAGE18_SYNTHETIC_KEY);const body=JSON.parse(req.body),user=body.messages.find(x=>x.role==='user').content;let output;if(typeof user==='string'){const p=JSON.parse(user);assert(p.allowedReviewFocus.length>1);output={reviewFocus:p.allowedReviewFocus.at(-1)};}else output={comparability:'comparable',reason:null,change:DESIGN_COMPARISON_CHANGES[0]};return {url:req.url,redirected:false,status:200,headers:{'content-type':'application/json'},body:JSON.stringify({object:'chat.completion',id:'synthetic-wire-history',model:f.modelConfig.model,created:1,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]})};}}};
const runtime=createImmutableGenerationRuntime(config);
async function fetchImpl(url,options){
 const operation=url.slice(url.lastIndexOf('/')+1);
 const request=new Request(url,{...options,headers:{...options.headers,origin},signal:options.signal});
 const running=requestMetrics.trackRuntime(runtime.handle(request));inflight.add(running);
 let remove=()=>{};
 const abort=new Promise((_,reject)=>{const listener=()=>{requestMetrics.noteAbort();reject(new DOMException('Synthetic client aborted','AbortError'));};if(options.signal.aborted)listener();else{options.signal.addEventListener('abort',listener,{once:true});remove=()=>options.signal.removeEventListener('abort',listener);}});
 void running.then(response=>{phaseCounts.set(operation,(phaseCounts.get(operation)||0)+1);},()=>{}).finally(()=>inflight.delete(running));
 try{
  const response=await Promise.race([running,abort]);remove();
  if(!response.body)return response;
  const reader=response.body.getReader();let stopped=false,onAbort;
  const cleanup=()=>{if(stopped)return;stopped=true;options.signal.removeEventListener('abort',onAbort);};
  const body=new ReadableStream({
   start(controller){onAbort=()=>{if(stopped)return;requestMetrics.noteAbort();cleanup();controller.error(new DOMException('Synthetic response aborted','AbortError'));void reader.cancel().catch(()=>{});};options.signal.addEventListener('abort',onAbort,{once:true});if(options.signal.aborted)onAbort();},
   async pull(controller){try{const part=await reader.read();if(stopped)return;if(part.done){cleanup();controller.close();}else controller.enqueue(part.value);}catch(error){if(!stopped){cleanup();controller.error(error);}}},
   async cancel(){cleanup();await reader.cancel();}
  });
  return new Response(body,{status:response.status,headers:response.headers});
 }finally{remove();}
}
const client=createPreparedHttpClient({enabled:true,origin,documentOrigin:origin,credentialProvider:()=>f.credential,fetchImpl,allowUploads:true,allowCandidates:true,allowVisionCandidates:true,allowComparisonCandidates:true,allowSynthesisCandidates:true,approvalProvider:i=>i.operation==='upload'?f.grantUpload(i.requestId,i.stage,i.angle):f.grantView([i.mediaId]),candidateApprovalProvider:i=>f.grantView(i.mediaIds??[i.mediaId])});
async function measured(operation,work){return requestMetrics.measure(operation,{workflowRevision:head?.revision??null,nativeRevision:head?.session.revision??null},async()=>{const start=performance.now(),result=await work();assert(performance.now()-start<30000,'full response must finish within the unchanged default client deadline');return result;});}
async function dispatch(intent){const requestId='wire-history-'+(++serial),r=await client.dispatch(scope,{requestId,expectedRevision:head.revision,intent});head=r.record;return r;}
async function upload(id,stage,angle){await client.uploadMedia(scope,{requestId:id,bytes:f.bytes,mime:'image/png',stage,angle});await dispatch({type:'attach_media',mediaIds:[id]});}
async function synth(requestId){await f.issueCandidateRequest({requestId,candidateKind:'completion_synthesis',side:'left'});return client.synthesize(scope,{requestId,side:'left'});}
async function captureBundle(){
 const c=await f.acquire();let failed=true;
 try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) AS locked");const ops=createDependencyAuthorityCapabilities(c),authority=await ops.authorize({credential:f.credential,scope}),bundle=await ops.readBundle();validateAuthorizedDependencyBundle(bundle,authority);await ops.recheck(authority);await ops.clear();await c.query('COMMIT');failed=false;
  const data=JSON.stringify({syntheticOnly:true,authority,bundle});assert(Buffer.byteLength(data)<=64*1024*1024);assert(!data.includes(f.credential));assert(!data.includes(STAGE18_SYNTHETIC_KEY));
  writeFileSync(new URL('synthetic-history-bundle.json',evidenceDirectory),data,{mode:0o600});bundleCaptured=true;
  console.log(stage+'_SYNTHETIC_BUNDLE '+JSON.stringify({bytes:Buffer.byteLength(data),workflowRows:bundle.workflowRows.length,nativeRevision:bundle.workflowRows.at(-1).record.session.revision,fullVersions:bundle.fullRows.length,fullNativeRevisions:bundle.fullRows.map(v=>v.record.snapshot.evidence.session.revision)}));
 }finally{await c.release(failed?Error('synthetic diagnostic failed'):undefined);}
}
try{
 head=(await client.load(scope)).record;
 for(const phase of ['proposal','execution','completed_review'])await dispatch({type:'advance',phase});
 for(const angle of ['front','back','left']){
  const before=angle+'-before',after=angle+'-after';await upload(before,'before',angle);await upload(after,'after',angle);
  const requestId='wire-compare-'+angle,input={requestId,candidateKind:'completion_comparison',beforeMediaId:before,afterMediaId:after,angle};
  await f.issueCandidateProcessing(input);await f.issueCandidateRequest(input);
  const result=await client.compare(scope,{requestId,beforeMediaId:before,afterMediaId:after});
  await dispatch({type:'accept_model_candidate',candidateId:result.candidate.id,selectedIndices:[0]});
  if(angle==='front'){
   await dispatch({type:'confirm_entry',entryId:result.candidate.candidate.entries[0].id,text:'【合成】员工明确核对：'+result.candidate.candidate.entries[0].value});
   const localResult=await synth('wire-local-synthesis');assert.equal(localResult.candidate.synthesis.generation,'deterministic');
   await dispatch({type:'accept_model_candidate',candidateId:localResult.candidate.id,selectedIndices:[0]});
  }
 }
 assert.equal(head.photoRefs.length,6);assert.equal(head.modelCandidates.length,4);
 for(const checkpoint of [16,24,32]){
  if(head.session.phase==='archive')await dispatch({type:'reopen',resumePhase:'completed_review',reason:'【合成】追加离线历史验收记录。'});
  while(head.session.revision<checkpoint)await dispatch({type:'record_source',kind:'text',text:'【合成历史】明确保留原始记录 '+(head.session.revision+1)+'，不推断操作。'});
  assert.equal(head.session.revision,checkpoint);
  head=(await measured('load',()=>client.load(scope))).record;
  const requestId='wire-synthesis-'+checkpoint,issued=await f.issueCandidateRequest({requestId,candidateKind:'completion_synthesis',side:'left'});lastSynthesisAttempt=issued.ownerKey;
  const first=await measured('synthesize',()=>client.synthesize(scope,{requestId,side:'left'}));assert.equal(first.candidate.synthesis.generation,'model_review_focus');
  const sent=providerCalls,opened=keyOpens,replayed=await measured('synthesis_replay',()=>client.synthesize(scope,{requestId,side:'left'}));assert.equal(replayed.replayed,true);assert.equal(providerCalls,sent);assert.equal(keyOpens,opened);
  await dispatch({type:'archive'});
  const snapshot=await measured('snapshot',()=>client.snapshot(scope)),old=await measured('full_load_before',()=>client.history(scope));
  const saved=await measured('full_append',()=>client.archive(scope,{requestId:'wire-full-'+checkpoint,expectedVersion:old.currentVersion,expectedParentDigest:old.currentDigest,snapshot:snapshot.snapshot}));
  const current=await measured('full_load_after',()=>client.history(scope));assert.equal(current.currentVersion,[16,24,32].indexOf(checkpoint)+1);assert.deepEqual(current.versions.at(-1),saved.version);
  console.log(stage+'_LONG_CHECKPOINT '+JSON.stringify({checkpoint,workflowRevision:head.revision,nativeRevision:head.session.revision,fullVersions:current.currentVersion,nativeArchives:head.archives.length,photoRefs:head.photoRefs.length,acceptedCandidates:head.modelCandidates.length,wire:f.wireStats()}));
 }
 await captureBundle();
 console.log('PASS bounded long history: 16/24/32 native checkpoints, three distinct full archives, six photo refs, four immutable accepted candidates, no replay provider calls.');
}finally{
 // An abort is not cancellation of an already executing DB operation. Do not
 // tear down its connection and falsely report it as a known non-write outcome.
 try{
  await Promise.allSettled([...inflight]);
  await requestMetrics.drain();
  const metrics=requestMetrics.snapshot();let uncertainRequestFinal=null;
  if(['synthesize','synthesis_replay'].includes(metrics.at(-1)?.operation)&&metrics.at(-1)?.clientCutoff.error?.outcome==='uncertain'&&lastSynthesisAttempt){
   assert(/^[a-f0-9]{64}$/.test(lastSynthesisAttempt));
   const state=f.sqlAdmin(`SELECT record->>'state' FROM design_policy_private.attempts WHERE owner_key='${lastSynthesisAttempt}'`);
   assert(['','pending','dispatch_claimed','completed','uncertain','not_sent'].includes(state));
   uncertainRequestFinal={ledgerState:state||null,automaticRetries:0,clientOutcome:'uncertain'};
   console.log(stage+'_UNCERTAIN_REQUEST_FINAL '+JSON.stringify(uncertainRequestFinal));
  }
  if(!bundleCaptured)try{await captureBundle();}catch{console.log(stage+'_BUNDLE_CAPTURE '+JSON.stringify({saved:false,code:'SYNTHETIC_CAPTURE_FAILED'}));}
  writeFileSync(new URL('wire-long-history-summary.json',evidenceDirectory),JSON.stringify({stage,proofReadsEnabled,metrics,providerCalls,keyOpens,phaseCounts:Object.fromEntries(phaseCounts),uncertainRequestFinal},null,2),{mode:0o600});
 }finally{await f.cleanup();console.log('Verified exact '+stage+' long-history wire fixture cleanup.');}
}
