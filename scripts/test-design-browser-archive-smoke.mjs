/** Stage37 single real-PG runtime archive write diagnostic. No native worker,
 * browser, loopback or external service. No weakening to make a failure pass. */
import assert from 'node:assert/strict';
import {createBrowserViewsRuntimeFixture} from './fixtures/browser-views-runtime.mjs';
let f;try{
 f=await createBrowserViewsRuntimeFixture();const old=await f.seedOldFull(),runtime=f.makeBrowserRuntime();
 const post=async(path,body)=>{const r=await runtime.handle(new Request(f.origin+'/api/design/'+path,{method:'POST',headers:{origin:f.origin,'x-employee-session':f.credential,'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 const preview=await post('workflow-view/snapshot',{scope:f.scope});assert.equal(preview.status,200);const q={scope:f.scope,requestId:'stage37-minimal-archive',expectedVersion:1,expectedParentDigest:old.full.versions[0].sha256,sourceRevision:preview.body.result.sourceRevision,sourceDigest:preview.body.result.sourceDigest},out=await post('archive-view/append',q),after=await f.capturePrivate();
 console.log('BROWSER_ARCHIVE_SMOKE '+JSON.stringify({status:out.status,safeCode:out.body.error?.code??null,commandRows:f.commandCount(),fullVersions:after.full.versions.length,recordUnchanged:after.recordDigest===old.recordDigest,oldFullUnchanged:after.versionDigests[0]===old.versionDigests[0],sqlDiagnostics:f.sqlDiagnostics,sqlStages:f.sqlStages}));
 assert.equal(out.status,200);assert.equal(out.body.result.appliedVersion,2);assert.equal(f.commandCount(),1);assert.equal(after.full.versions.length,2);const replay=await post('archive-view/append',q);assert.equal(replay.status,200);assert.equal(replay.body.result.replayed,true);assert.equal(replay.body.result.appliedVersion,2);assert.equal(f.commandCount(),1);assert.deepEqual(await f.capturePrivate(),after);console.log('PASS single archive real-PG smoke + exact same-ID replay');
}finally{await f?.cleanup();console.log('Exact single-archive synthetic PG resources cleaned.');}
