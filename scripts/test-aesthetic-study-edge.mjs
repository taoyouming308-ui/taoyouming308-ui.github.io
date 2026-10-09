import fs from 'node:fs';import assert from 'node:assert/strict';
let handler;const calls=[];let employee={id:1,username:'synthetic',store:'A',role:'staff',active:true,employment_status:'active'},admin={id:2,username:'admin-test',store:'',role:'admin',active:true,employment_status:'active'},valid=true;
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://db.test':'synthetic-server-only'},serve:fn=>handler=fn};
const feed=JSON.parse(fs.readFileSync('docs/aesthetic-training/feed.v1.json'));
globalThis.fetch=async(url,init={})=>{
 calls.push({url,init});let body=[];
 if(url.includes('github.io/'))body=feed;
 else if(url.includes('employee_booking_sessions?'))body=valid?[{username:'synthetic',store:'A'}]:[];
 else if(url.includes('aesthetic_training_admin_sessions?'))body=valid?[{username:'admin-test',store:'',role:admin.role}]:[];
 else if(url.includes('staff?'))body=url.includes('username=eq.admin-test')?[admin]:url.includes('username=eq.synthetic')?[employee]:[employee];
 else if(url.includes('aesthetic_study_cases?')&&init.method!=='POST')body=[{case_id:feed.items[0].id,content_version:version}];
 else if(url.includes('rpc/aesthetic_study_ingest')){const p=JSON.parse(init.body);assert.equal(p.p_employee_id,1);assert.equal(p.p_store,'A');assert.equal(p.p_username,'synthetic');body={accepted:p.p_events.map(e=>e.event_id)};}
 return new Response(JSON.stringify(body),{status:200});
};
await import('../supabase/functions/aesthetic-study/index.ts');
const token='t'.repeat(64),request=p=>handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify(p)}));
assert.equal((await request({operation:'bootstrap',username:'synthetic',store:'A'})).status,403);
let r=await request({operation:'bootstrap',session_token:token});assert.equal(r.status,200);const data=await r.json(),version=data.cases[0].version;
assert.equal(data.user.id,1);assert(!('session_token'in data.user));
assert.equal((await request({operation:'bootstrap',session_token:token,employee_id:999})).status,403);
const e={event_id:'11111111-1111-4111-8111-111111111111',visit_id:'22222222-2222-4222-8222-222222222222',case_id:feed.items[0].id,content_version:version,kind:'visit',at:new Date().toISOString()};
r=await request({operation:'sync',session_token:token,username:'imposter',store:'other',events:[e]});assert.equal(r.status,200);
valid=false;assert.equal((await request({operation:'sync',session_token:token,events:[e]})).status,403);valid=true;
for(const patch of [{active:false},{employment_status:'pending'},{store:'B'}]){const saved=employee;employee={...employee,...patch};assert.equal((await request({operation:'bootstrap',session_token:token})).status,403);employee=saved;}
admin.role='store_admin';assert.equal((await request({operation:'admin_overview',admin_token:token})).status,403);admin.role='admin';
assert.equal((await request({operation:'admin_overview',admin_token:token,offset:-1})).status,400);
assert.equal((await request({operation:'sync',session_token:token,events:[{...e,content_version:'fake'}]})).status,400);
assert.equal((await handler(new Request('https://edge.test',{method:'GET'}))).status,405);
assert.equal((await handler(new Request('https://edge.test',{method:'POST',body:'x'.repeat(40001)}))).status,413);
assert(!calls.some(c=>c.url.includes('password_hash')));
console.log('study Edge handler: fake identity, revoked session, inactive/transferred staff, storeadmin denial, server attribution, bounds passed');
