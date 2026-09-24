#!/usr/bin/env node
// Synthetic Edge Function test: no production reads or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {webcrypto} = require('node:crypto');

const source = fs.readFileSync('supabase/functions/staff-access-api/index.ts','utf8').replace(/^import .*;\n/gm,'');
const token = '11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222';
let role = 'admin';
let profile = {id:17,phone:'13800000000',name:'合成客户',shop_name:'甲店',notes:JSON.stringify({follow_ups:[{content:'已有记录'}]})};
let concurrentOnce = false;
const reads = [], writes = [];
let context;
context = vm.createContext({console,Request,Response,TextEncoder,crypto:webcrypto,Date,
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://synthetic.local':'synthetic-service-key'},serve:fn=>{context.handler=fn;}},
  fetch:async(url,options={})=>{
    const path=String(url).split('/rest/v1/')[1]||'';
    const method=options.method||'GET';
    if(method==='GET') reads.push(path);
    if(method==='PATCH') writes.push({path,body:JSON.parse(options.body)});
    let result=[];
    if(path.startsWith('staff_access_sessions?')) result=[{staff_id:2,credential_hash:'current-hash',role,store:'甲店'}];
    else if(path.startsWith('staff?')) result=[{id:2,username:'测试管理员',password_hash:'current-hash',role,store:'甲店',active:true,employment_status:'active'}];
    else if(path.startsWith('customer_profiles?') && method==='GET') result=[profile];
    else if(path.startsWith('customer_profiles?') && method==='PATCH') {
      const filter=decodeURIComponent(path);
      if(concurrentOnce){
        concurrentOnce=false;
        profile={...profile,notes:JSON.stringify({follow_ups:[{content:'已有记录'},{content:'并发写入'}]})};
        result=[];
      } else if(filter.includes(`notes=eq.${profile.notes}`) || (filter.includes('notes=is.null') && profile.notes==null)) {
        profile={...profile,...JSON.parse(options.body)};
        result=[profile];
      }
    } else throw new Error(`Unexpected ${method} ${path}`);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  }});
vm.runInContext(stripTypeScriptTypes(source),context);
const post=payload=>context.handler(new Request('https://synthetic.local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,session_token:token})}));

(async()=>{
  let response=await post({operation:'customer_profiles_admin',search:'13800000000',store:'甲店',limit:200});
  assert.equal(response.status,200);
  assert(reads.some(path=>decodeURIComponent(path).includes('shop_name=eq.甲店')&&decodeURIComponent(path).includes('phone.ilike')), 'profile listing must use the server-built filter');

  role='store_admin';
  const readsBefore=reads.length;
  response=await post({operation:'customer_profiles_admin',store:'乙店'});
  assert.equal(response.status,403,'store admin must not access global customer archive');
  assert.equal(reads.length,readsBefore+2,'rejected customer operation should only validate session/actor');
  role='admin';

  concurrentOnce=true;
  response=await post({operation:'customer_followup_append',profile_id:17,content:'本次回访',next:'2026-10-24'});
  assert.equal(response.status,200,'concurrent note change should be retried');
  const saved=JSON.parse(profile.notes);
  assert.deepEqual(saved.follow_ups.map(x=>x.content),['已有记录','并发写入','本次回访']);
  assert.equal(saved.follow_ups[2].barber,'测试管理员');
  assert.equal(saved.follow_ups[2].next,'2026-10-24');
  assert.equal(writes.length,2,'CAS should retry after the concurrent modification');

  profile={...profile,notes:'legacy free text'};
  response=await post({operation:'customer_followup_append',profile_id:17,content:'不应覆盖'});
  assert.equal(response.status,403,'malformed legacy notes require manual review');
  assert.equal(writes.length,2,'malformed notes must not be overwritten');
  assert.equal(profile.notes,'legacy free text');
  console.log('customer admin API tests passed: admin role gate, scoped filters, concurrent append and safe legacy-note handling');
})().catch(error=>{console.error(error);process.exitCode=1;});
