/** Stage25 test scenario only. Reuses the actual UI, HTTP, long-history fixture
 * and worker. No replacement product implementation, storage or real network.
 * Importing this module performs no I/O and creates no browser/database.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

/** Fixed disposable-fixture inspection only. No raw IDs, authority, key or
 * customer data is returned/logged. This is an observation, not authorization. */
export function readLongTargetLedger(fixture,ownerKey){
 assert.match(ownerKey,/^[a-f0-9]{64}$/);
 const value=JSON.parse(fixture.sqlAdmin(`WITH j AS (SELECT * FROM design_durable_synthesis.jobs WHERE operation_id='${ownerKey}'), a AS (SELECT * FROM design_policy_private.attempts WHERE owner_key='${ownerKey}'), p AS (SELECT * FROM design_policy_private.approvals WHERE owner_key='${ownerKey}'), r AS (SELECT * FROM design_policy_private.issued_receipts WHERE receipt_id IN (SELECT receipt_id FROM p)) SELECT jsonb_build_object('jobs',(SELECT count(*) FROM j),'attempts',(SELECT count(*) FROM a),'approvals',(SELECT count(*) FROM p),'issuedReceipts',(SELECT count(*) FROM r),'jobRevision',(SELECT revision FROM j),'jobState',(SELECT state FROM j),'jobDeadlineMs',(SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM j),'attemptRevision',(SELECT (record->>'revision')::bigint FROM a),'attemptState',(SELECT record->>'state' FROM a),'approvalRevision',(SELECT (record->>'revision')::bigint FROM p),'approvalDeadlineMs',(SELECT (record->>'expiresAt')::bigint FROM p),'approvalConsumed',(SELECT record->'consumedBy' IS DISTINCT FROM 'null'::jsonb FROM p),'issuedActive',(SELECT active FROM r),'issuedDeadlineMs',(SELECT (record->>'expiresAt')::bigint FROM r))`));
 for(const field of ['jobs','attempts','approvals','issuedReceipts'])assert(Number.isSafeInteger(value[field])&&value[field]>=0&&value[field]<=1);
 for(const field of ['jobState','attemptState'])assert(value[field]===null||['queued','leased','pending','dispatch_claimed','completed','uncertain','not_sent','cancelled'].includes(value[field]));
 return value;
}

export async function saveLongBrowserDiagnostics({page,fixture,calls,issued,ledgerSnapshots,bodyFailures,diagnostic,passed,evidence}){
 let client=null;try{client=await page?.evaluate(()=>({fetchStarts:window.__fetchStarts||[],headers:window.__headers||[]}));}catch{}
 const plan=Array.from(issued.values())[0];let finalLedger=null,ledgerReadFailed=false;
 if(plan)try{finalLedger=readLongTargetLedger(fixture,plan.ownerKey);}catch{ledgerReadFailed=true;}
 const enqueue=calls.filter(c=>c.path==='api/design/synthesis-operations/enqueue');
 const report={faultMode:'partial_body_after_headers',passed,diagnostic,appFetchStarts:client?.fetchStarts??null,headers:client?.headers??null,serverEnqueuePosts:enqueue.length,issuedRequestCount:issued.size,allEnqueueSameRequest:plan?enqueue.every(c=>c.requestId===plan.intent.requestId):null,allObservedOperationIdsMatch:plan?enqueue.filter(c=>c.operationReturned).every(c=>c.operationMatches===true):null,ledgerSnapshots,finalLedger,ledgerReadFailed,bodyFailures};
 await mkdir(evidence,{recursive:true});await writeFile(evidence+'/worker-long-browser-diagnostics.json',JSON.stringify(report,null,2),{mode:0o600});
 console.log('STAGE25_BROWSER_DIAGNOSTICS '+JSON.stringify(report));
}

export async function runLongDurableBrowserScenario({page,context,harness:h,open,calls,issued,pass,evidence,ledgerSnapshots,bodyFailures,diagnostic}){
 Object.assign(diagnostic,{stage:'before_enqueue',providerCalls:0,providerEntered:false,providerAborted:false});
 try{
 const initial=structuredClone(h.head()),history=await h.client.history(h.scope);
 assert.equal(initial.session.revision,32);assert.equal(history.currentVersion,2);
 assert.equal(initial.photoRefs.length,6);assert.equal(initial.modelCandidates.length,6);
 const count=path=>calls.filter(c=>c.path==='api/design/'+path).length;
 await open();
 await page.locator('[data-model-side]').selectOption('left');
 await page.locator('[data-action="model-synthesize"]').click();
 await page.locator('[role="alert"]').filter({hasText:'HTTP_OUTCOME_UNCERTAIN'}).waitFor();
 diagnostic.bodyReadUnknownObserved=true;
 assert.equal(issued.size,1);assert.equal(count('synthesis-operations/enqueue'),1);
 diagnostic.stage='lookup';
 const plan=Array.from(issued.values())[0];assert.equal(plan.intent.kind,'external');
 const before=ledgerSnapshots.find(s=>s.phase==='committed_enqueue').value;
 for(const field of ['jobs','attempts','approvals','issuedReceipts'])assert.equal(before[field],1);
 assert.equal(before.jobState,'queued');assert.equal(before.attemptState,'pending');
 assert.equal(diagnostic.headersObserved,true);
 assert.match(await page.locator('[data-synthesis-request]').textContent(),new RegExp(plan.intent.requestId));
 assert.equal(await page.locator('[data-model-candidate]').count(),0);
 await page.locator('[data-action="model-retry"]').click();
 await page.locator('[data-synthesis-operation-state]').getByText('已入队，尚未完成',{exact:true}).waitFor();
 const lookups=calls.filter(c=>c.path==='api/design/synthesis-operations/lookup');
 assert.equal(lookups.length,1);assert.equal(lookups[0].requestId,plan.intent.requestId);
 assert.equal(count('synthesis-operations/enqueue'),1);
 assert.deepEqual(readLongTargetLedger(h.fixture,plan.ownerKey),before,'read-only lookup must not revise or extend the original task/ledger/approval');
 pass('lost committed 202 is recovered only by the exact original request lookup, never enqueue retry');

 diagnostic.stage='reopen';
 await page.locator('[data-prepared-close]').click();await open();
 assert.equal(await page.locator('[data-synthesis-operation]').count(),0);
 await page.locator('[data-action="synthesis-list"]').click();
 await page.locator('[data-action="synthesis-resume"][data-operation-id="'+plan.ownerKey+'"]').click();
 await page.locator('[data-synthesis-operation-state]').getByText('已入队，尚未完成',{exact:true}).waitFor();
 assert.equal(count('synthesis-operations/enqueue'),1);assert.equal(count('synthesis-operations/cancel'),0);
 assert.deepEqual(readLongTargetLedger(h.fixture,plan.ownerKey),before,'close/list/status must not revise or extend the original task/ledger/approval');
 pass('original homepage closes and recovers the same long-history task without claiming cancellation');

 let providerCalls=0,providerStartedAt=null,providerAbortedAt=null,entered;
 const providerEntered=new Promise(resolve=>{entered=resolve;});
 const worker=h.makeWorker({transport:request=>{
  providerCalls++;diagnostic.providerCalls=providerCalls;diagnostic.providerEntered=true;providerStartedAt=performance.now();
  assert.equal(request.body,plan.body);assert.equal(request.signal.aborted,false);
  assert.equal(request.url,'https://api.deepseek.com/chat/completions');
  // Entire worker budget owns this signal. No artificial longer response timer,
  // no manufactured completion, and no external/provider network call.
  return new Promise((resolve,reject)=>{
   const abort=()=>{diagnostic.providerAborted=true;providerAbortedAt=performance.now();reject(new DOMException('Synthetic provider aborted','AbortError'));};
   request.signal.addEventListener('abort',abort,{once:true});
   if(request.signal.aborted)abort();else entered(true);
  });
 }});
 diagnostic.stage='worker';
 const started=performance.now(),running=worker.runOnce();
 const first=await Promise.race([providerEntered,running.then(result=>result)]);
 assert.equal(first,true,'worker must reach one mock dispatch before the timeout negative case');
 await page.locator('[data-action="synthesis-check"]').click();
 await page.locator('[data-synthesis-operation-state]').getByText('已领取外发资格，可能已发送',{exact:true}).waitFor();
 const result=await running,ended=performance.now();diagnostic.workerState=result.state;diagnostic.workerMs=Math.round(ended-started);
 assert.deepEqual(result,{state:'uncertain',operationId:plan.ownerKey});
 assert.equal(providerCalls,1);assert.notEqual(providerAbortedAt,null);
 assert(providerAbortedAt-started>=29000&&providerAbortedAt-started<32000,'default worker timeout must actually abort, without a longer budget');
 assert(ended-started<33000,'worker settlement must remain bounded, not extend execution budget');
 const afterWorkerLedger=readLongTargetLedger(h.fixture,plan.ownerKey);ledgerSnapshots.push({phase:'worker_settled_before_queries',value:afterWorkerLedger});
 await page.locator('[data-action="synthesis-check"]').click();
 await page.locator('[data-synthesis-operation-state]').getByText('执行结果不确定，不能当作未发送',{exact:true}).waitFor();
 assert.match(await page.locator('[data-synthesis-operation]').textContent(),/不能据此认定没有执行或没有费用/);
 assert.equal(await page.locator('[data-model-candidate]').count(),0);
 assert.equal(await page.locator('[data-command="accept_model_candidate"]').count(),0);
 pass('actual 30-second worker timeout settles uncertain and exposes no candidate or automatic adoption');

 // A second manual query is a read, not a generation/worker retry. Keep the
 // poisoned timed-out worker closed; do not create a fresh execution identity.
 await page.locator('[data-action="model-retry"]').click();
 await page.locator('[data-synthesis-operation-state]').getByText('执行结果不确定，不能当作未发送',{exact:true}).waitFor();
 diagnostic.stage='final_readback';
 const final=(await h.client.lookupSynthesis(h.scope,plan.intent.requestId)).operation;
 const finalLedger=readLongTargetLedger(h.fixture,plan.ownerKey);ledgerSnapshots.push({phase:'after_timeout_queries',value:finalLedger});
 assert.deepEqual(finalLedger,afterWorkerLedger,'manual status and original request lookup must not revise/renew the settled job or ledger');
 for(const field of ['jobs','attempts','approvals','issuedReceipts'])assert.equal(finalLedger[field],1);
 for(const field of ['jobDeadlineMs','approvalDeadlineMs','issuedDeadlineMs'])assert.equal(finalLedger[field],before[field]);
 assert.equal(finalLedger.jobState,'uncertain');assert.equal(finalLedger.attemptState,'uncertain');
 assert(finalLedger.jobRevision>before.jobRevision);assert(finalLedger.attemptRevision>before.attemptRevision);
 assert.equal(final.id,plan.ownerKey);assert.equal(final.requestId,plan.intent.requestId);
 assert.equal(final.state,'uncertain');assert.equal(final.resultAvailable,false);assert.equal(final.candidateId,null);
 assert.equal(count('synthesis-operations/enqueue'),1);assert.equal(providerCalls,1);assert.equal(issued.size,1);
 assert(calls.filter(c=>c.path==='api/design/synthesis-operations/status').every(c=>c.operationId===plan.ownerKey));
 assert.equal(count('candidate/load'),0);assert.equal(count('synthesis-operations/cancel'),0);
 assert.deepEqual((await h.client.load(h.scope)).record,initial);
 assert.deepEqual(await h.client.history(h.scope),history);
 pass('repeated original-task queries neither resend generation nor change native records or two original archives');

 await mkdir(evidence,{recursive:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:evidence+'/worker-long-mobile-uncertain.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:evidence+'/worker-long-desktop-uncertain.png',fullPage:true});
 const headers=await page.evaluate(()=>window.__headers);
 const taskHeaders=headers.filter(x=>x.path.startsWith('/api/design/'));
 assert.equal(taskHeaders.filter(x=>x.status===undefined).length,0,'the intentional loss happens after actual 202 headers, not before them');
 assert.equal(taskHeaders.filter(x=>x.path==='/api/design/synthesis-operations/enqueue'&&x.status===202).length,1);
 assert.equal(await page.evaluate(()=>window.__fetchStarts.filter(x=>x.path==='/api/design/synthesis-operations/enqueue').length),1);
 assert.equal(bodyFailures.filter(x=>x.path==='/api/design/synthesis-operations/enqueue').length,1);
 assert(taskHeaders.every(x=>x.headersMs<30000));
 assert(taskHeaders.filter(x=>x.status!==undefined).every(x=>x.status>=200&&x.status<300));
 assert.equal(await page.evaluate(()=>window.__mic+window.__persistent+localStorage.length+sessionStorage.length),0);
 assert.deepEqual(await context.cookies(),[]);
 assert(!calls.some(x=>x.path==='api/design/candidate/synthesize'));
 pass('unchanged 30-second client, no microphone or browser persistence, no synchronous generation bypass');
 const report={faultMode:'partial_body_after_headers',bodyReadUnknownObserved:diagnostic.bodyReadUnknownObserved,headersObserved:diagnostic.headersObserved,nativeRevision:initial.session.revision,workflowRevision:initial.revision,fullArchives:history.currentVersion,photoRefs:initial.photoRefs.length,acceptedCandidates:initial.modelCandidates.length,providerCalls,enqueueCalls:count('synthesis-operations/enqueue'),lookupCalls:count('synthesis-operations/lookup'),workerMs:Math.round(ended-started),abortFromWorkerStartMs:Math.round(providerAbortedAt-started),transportWaitMs:Math.round(providerAbortedAt-providerStartedAt),postAbortSettlementMs:Math.round(ended-providerAbortedAt),resultState:final.state,finalLedger,headers};
 await writeFile(evidence+'/worker-long-browser-summary.json',JSON.stringify(report,null,2),{mode:0o600});
 return report;
 }catch(error){console.error('STAGE25_BROWSER_SCENARIO_FAILURE '+JSON.stringify({...diagnostic,errorCode:/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code??'')?error.code:'ASSERT_OR_BROWSER_FAILURE'}));throw error;}
}
