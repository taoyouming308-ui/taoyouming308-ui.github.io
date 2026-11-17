import assert from 'node:assert/strict';
import {createImmutableGenerationRuntime} from '../packages/design-production-adapter/immutable-generation-runtime.mjs';
let touched=0;
const deny=()=>{touched++;throw Error('UNEXPECTED_CAPABILITY_USE');};
const request=()=>new Request('https://synthetic.example/api/design/managed-normalized/describe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
const base={enabled:true,acquireClient:deny,publicOrigin:'https://synthetic.example',allowedRequestOrigins:['https://synthetic.example']};
let count=0;
for(const [label,managedNormalized] of [
 ['absent',undefined],['disabled',{enabled:false,executionMode:'synthetic_mock',acquireVerificationClient:deny}],
 ['no explicit mode',{enabled:true,acquireVerificationClient:deny}],
 ['live mode rejected',{enabled:true,executionMode:'production',acquireVerificationClient:deny}],
 ['no independent verification reader',{enabled:true,executionMode:'synthetic_mock'}],
]){
 const runtime=createImmutableGenerationRuntime({...base,managedNormalized});
 assert.equal(touched,0);const r=await runtime.handle(request());assert.equal(r.status,404);assert.equal((await r.json()).error,'IMMUTABLE_GENERATION_ROUTE_CLOSED');assert.equal(touched,0);console.log('ok '+(++count)+' - '+label+' closed without connection or network');
}
const runtime=createImmutableGenerationRuntime({...base,managedImages:{enabled:true},managedModel:{enabled:true},managedViews:{enabled:true}});
assert.equal((await runtime.handle(request())).status,404);assert.equal(touched,0);console.log('ok '+(++count)+' - old flags cannot enable normalized route');
createImmutableGenerationRuntime({...base,managedNormalized:{enabled:true,executionMode:'synthetic_mock',acquireVerificationClient:deny,storage:{read:deny},sealer:{open:deny,digest:deny},transport:deny}});
assert.equal(touched,0);console.log('ok '+(++count)+' - explicit test composition construction has no eager credentials, storage, verification or model calls');
console.log('normalized runtime tests: '+count+' passed');
