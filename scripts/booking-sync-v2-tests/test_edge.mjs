import fs from 'node:fs';
import {webcrypto,generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=new URL('.',import.meta.url);
const original=fs.readFileSync(new URL('edge-v1-reference.ts',dir),'utf8');
let source=fs.readFileSync(new URL('../../supabase/functions/mgj-booking-sync/index.ts',dir),'utf8');
assert.equal(source.match(/const PUBLIC_KEY_BASE64 = (.*);/)[0],original.match(/const PUBLIC_KEY_BASE64 = (.*);/)[0]);
assert.equal(source.slice(source.indexOf('async function authenticate'),source.indexOf('function validDate')),original.slice(original.indexOf('async function authenticate'),original.indexOf('function validDate')));
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const raw=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
source=source.replace(/const PUBLIC_KEY_BASE64 = .*;/,`const PUBLIC_KEY_BASE64 = "${raw}";`);
fs.writeFileSync(new URL('edge-test-only.ts',dir),source);
let handler;let calls=[];
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://isolated.invalid': 'synthetic-key'},serve:f=>handler=f};
globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({protocol:2}));};
await import(new URL('edge-test-only.ts',dir));
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const base={shop_id:'1009951',date:today};
async function req(body,opts={}){const data=JSON.stringify(body);let ts=String(Math.floor(Date.now()/1000)+(opts.age||0));let signature=sign(null,Buffer.from(ts+'.'+data),privateKey).toString('base64url');if(opts.bad)signature='A'.repeat(86);return handler(new Request('https://isolated.invalid/',{method:'POST',body:data,headers:{'x-booking-sync-ts':ts,'x-booking-sync-signature':signature}}));}
for(const payload of [{...base,bookings:[]},{...base,protocol:1,operation:'commit',bookings:[]},{...base,protocol:2,operation:'begin'}, {...base,protocol:2,operation:'commit',lease_id:'bad'}]){assert.equal((await req(payload)).status,400);assert.equal(calls.length,0);}
assert.equal((await req({...base,protocol:2,operation:'begin',request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{bad:true})).status,401);assert.equal(calls.length,0);
assert.equal((await req({...base,protocol:2,operation:'begin',request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{age:-300})).status,401);assert.equal(calls.length,0);
assert.equal((await req({...base,protocol:2,operation:'begin',request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})).status,200);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/rpc/mgj_booking_begin_v2'));
assert.equal((await req({...base,protocol:2,operation:'abort',lease_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})).status,200);assert.equal(calls.length,2);assert.ok(calls[1].url.endsWith('/rpc/mgj_booking_abort_v2'));
console.log('20 edge assertions passed; all network mocked; original signing key and verifier unchanged');
fs.unlinkSync(new URL('edge-test-only.ts',dir));
