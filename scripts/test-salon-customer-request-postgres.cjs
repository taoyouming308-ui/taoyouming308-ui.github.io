// Explicit opt-in integration test: creates and removes one synthetic Docker database.
// Run: node scripts/test-salon-customer-request-postgres.cjs
const {execFileSync,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asyncExec=promisify(execFile);
const root=path.resolve(__dirname,'..');
const container=`salon-request-test-${process.pid}-${Date.now()}`;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
const sql=input=>docker(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input);
const concurrent=async text=>(await asyncExec('docker',['exec',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At','-c',text],{timeout:20000})).stdout;
async function main(){
 let created=false;
 try{
  docker(['run','--name',container,'-e','POSTGRES_PASSWORD=test','-d','postgres:15']);created=true;
  let ready=false;
  for(let i=0;i<60;i++){
   // The image's temporary initialization server accepts Unix sockets but not TCP.
   try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,200))}
  }
  assert.ok(ready,'PostgreSQL TCP readiness timed out');
  sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
  for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>/_salon_.*\.sql$/.test(f)).sort())
   sql(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  sql('set role service_role;\n'+fs.readFileSync(path.join(root,'scripts/test-salon-engagement.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/test-salon-customer-request-ownership.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'scripts/test-salon-staff-replay-and-customer-reads.sql'),'utf8'));
  const call=(key,evidence)=>`set role service_role;select public.salon_customer_set_consent('11111111-1111-4111-8111-111111111111',1,1,'${key}','marketing_messages',true,'{}','${evidence}');`;
  const same=await Promise.all([concurrent(call('concurrent-same-001','test-only')),concurrent(call('concurrent-same-001','test-only'))]);
  assert.equal(same[0],same[1],'same-key concurrent requests must return same result');
  assert.equal(sql("select count(*) from public.salon_customer_consents where evidence_ref='test-only';").trim(),'1');
  const changed=await Promise.allSettled([concurrent(call('concurrent-changed-001','variant-a')),concurrent(call('concurrent-changed-001','variant-b'))]);
  assert.equal(changed.filter(r=>r.status==='fulfilled').length,1);
  assert.match(changed.find(r=>r.status==='rejected').reason.stderr,/幂等键已被其他业务使用/);
  assert.equal(sql("select count(*) from public.salon_customer_consents where evidence_ref in ('variant-a','variant-b');").trim(),'1');
  const campaign=(key,message)=>`set role service_role;select public.salon_create_campaign(2,1,1,'${key}','并发合成活动','in_app','{}','${message}',current_date,current_date+7);`;
  const staffSame=await Promise.all([concurrent(campaign('staff-concurrent-same','one')),concurrent(campaign('staff-concurrent-same','one'))]);
  assert.equal(staffSame[0],staffSame[1]);
  const staffChanged=await Promise.allSettled([concurrent(campaign('staff-concurrent-change','two')),concurrent(campaign('staff-concurrent-change','three'))]);
  assert.equal(staffChanged.filter(r=>r.status==='fulfilled').length,1);
  assert.match(staffChanged.find(r=>r.status==='rejected').reason.stderr,/幂等键已被其他业务使用/);
  assert.equal(sql("select count(*) from public.salon_campaigns where name='并发合成活动';").trim(),'2');
  console.log('Salon request PostgreSQL passed: staff/customer ownership, replay, rollback, restricted reads, real-role access, concurrent identical and conflicting requests');
 }finally{
  if(created)docker(['rm','-f',container]);
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
