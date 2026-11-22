/** Pure retained-handler regression, no sockets/browser/PG. */
import test from 'node:test';import assert from 'node:assert/strict';
import {createDesignHttpHandler} from '../packages/design-production-adapter/http-handler.mjs';
import {IdentityCapabilityError} from '../packages/design-production-adapter/identity-capability-postgres.mjs';
import {assertIdentityRejection,IDENTITY_REJECTION} from './fixtures/normalized-http-rejection.mjs';
test('actual immutable identity error is exactly generic safe 400, not invented 401/403',async()=>{
 let work=0;const origin='https://synthetic-normalized.invalid',handler=createDesignHttpHandler({enabled:true,publicOrigin:origin,allowedRequestOrigins:[origin],employeeAdapter:{authenticate:async()=>{const e=new IdentityCapabilityError('IDENTITY_ACCESS_DENIED');e.message='PRIVATE_SENTINEL';throw e;},gate:{}},workflowService:{load:async()=>{work++;}}});
 const r=await handler(new Request(origin+'/api/design/workflow/load',{method:'POST',headers:{origin,'x-employee-session':'SYNTHETIC_TOKEN_01234567890123456789','content-type':'application/json'},body:'{}'}));assertIdentityRejection({status:r.status,body:await r.json()});assert.equal(work,0);
});
test('denial assertion rejects every status/code/outcome/data-disclosure substitution',()=>{
 for(const mutate of [v=>v.status=500,v=>v.status=409,v=>v.status=401,v=>v.body.error.code='OTHER',v=>v.body.result={private:'secret'},v=>v.body.error.outcome='not_sent',v=>v.body.error.retryable=true,v=>v.body.error.message+=' secret']){const v=structuredClone(IDENTITY_REJECTION);mutate(v);assert.throws(()=>assertIdentityRejection(v));}
});
