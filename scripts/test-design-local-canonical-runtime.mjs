import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalCanonicalImageRuntime} from '../packages/design-production-adapter/local-canonical-image-runtime.mjs';
test('default closed across all three entries before input inspection',async()=>{
 const r=createLocalCanonicalImageRuntime();
 for(const f of Object.values(r))await assert.rejects(f(null),{code:'LOCAL_CANONICAL_DISABLED'});
});
test('fixed seed rejects unsupported mime, edges and extra paths without Docker work',async()=>{
 const r=createLocalCanonicalImageRuntime({enabled:true});
 for(const q of [{mime:'image/png',maxEdge:1024,signal:null},{mime:'image/jpeg',maxEdge:1536,signal:null},{mime:'image/jpeg',maxEdge:1024,signal:null,path:'/tmp/other'}])await assert.rejects(r.prepareSyntheticSource(q),{code:'LOCAL_CANONICAL_INVALID'});
});
test('seed accessors/proxies rejected without evaluation',async()=>{
 const r=createLocalCanonicalImageRuntime({enabled:true});let calls=0;
 await assert.rejects(r.prepareSyntheticSource({get mime(){calls++;return 'image/jpeg';},maxEdge:1024,signal:null}),{code:'LOCAL_CANONICAL_INVALID'});
 await assert.rejects(r.prepareSyntheticSource(new Proxy({},{get(){calls++;throw Error('secret');}})),{code:'LOCAL_CANONICAL_INVALID'});
 assert.equal(calls,0);
});
test('pre-aborted fixed seed starts no container',async()=>{
 const r=createLocalCanonicalImageRuntime({enabled:true});const c=new AbortController();c.abort();
 await assert.rejects(r.prepareSyntheticSource({mime:'image/jpeg',maxEdge:1024,signal:c.signal}),{code:'LOCAL_CANONICAL_ABORTED'});
});
test('preflight copy failures and hash mismatch never wipe caller byte arrays',async()=>{
 const {normalizedVerificationFixture}=await import('./fixtures/managed-normalized-verification.mjs');
 const {managedImageDigest:digest}=await import('../packages/design-production-adapter/managed-image-contracts.mjs');
 const f=normalizedVerificationFixture(),s=f.sourceRecord,r=f.parentResponse;
 const declared={authority:s.owner,mediaId:s.mediaId,projectOrigin:s.object.projectOrigin,bucket:s.object.bucket,objectKey:s.object.key,objectVersion:s.object.version,expectedSourceSha256:s.source.sha256,mime:s.source.mime,byteLength:s.source.byteLength,width:80,height:120,orientation:'confirmed',immutable:true,active:true};
 Object.assign(r.descriptor.source,{width:80,height:120,bindingDigest:digest(declared)});Object.assign(r.descriptor.requestedTransform,{width:80,height:120});f.parentObjectReceipt.responseDigest=digest(r);
 const q={sourceRecord:s,parentResponse:r,parentObjectReceipt:f.parentObjectReceipt,sourceBytes:f.sourceBytes,parentBytes:f.parentBytes,signal:null};
 const runtime=createLocalCanonicalImageRuntime({enabled:true});const original=Buffer.from(f.sourceBytes),parent=Buffer.from(f.parentBytes);
 await assert.rejects(runtime.normalizeSynthetic({...q,parentBytes:null}),{code:'LOCAL_CANONICAL_INVALID'});
 await assert.rejects(runtime.normalizeSynthetic({...q,sourceBytes:Buffer.from('wrong source')}),{code:'LOCAL_CANONICAL_INVALID'});
 assert.deepEqual(f.sourceBytes,original);assert.deepEqual(f.parentBytes,parent);
});
