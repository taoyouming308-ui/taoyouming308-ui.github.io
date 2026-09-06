// Opt-in, disposable PostgreSQL only. Explicit transactions prove row-lock lifetime.
const assert=require('node:assert/strict');
const {startServer}=require('./salon-local-integration.cjs');
(async()=>{let app;try{
 app=await startServer();const auth='22222222-2222-4222-8222-222222222222';
 app.sql(`insert into public.salon_customers(organization_id,display_name) values(1,'合成时区顾客');
 insert into public.salon_customer_store_relations(organization_id,store_id,customer_id) values(1,1,1);
 insert into public.salon_customer_auth_identities(organization_id,customer_id,auth_user_id) values(1,1,'${auth}');
 insert into public.salon_catalog_items(organization_id,item_type,code,name,list_price,duration_minutes) values(1,'service','TZ','合成服务',10,30);
 insert into public.salon_catalog_store_settings(organization_id,store_id,catalog_item_id) values(1,1,2);`);
 const call=q=>JSON.parse(app.sql(`set role service_role;select ${q};`));
 const fails=(q,re)=>assert.throws(()=>call(q),e=>re.test(String(e.stderr)));
 let n=0;
 const booking=()=>{const i=++n,r=call(`public.salon_customer_request_booking('${auth}',1,1,'tz-booking-${String(i).padStart(8,'0')}',2,1,current_date+interval '${10+i} days 10 hours',current_date+interval '${10+i} days 10 hours 30 minutes','合成')`);call(`public.salon_review_customer_booking(1,1,1,${r.bookingRequestId},'tz-confirm-${String(i).padStart(8,'0')}','confirmed',1,'合成')`);return JSON.parse(app.sql(`select jsonb_build_object('id',id,'start',starts_at,'end',ends_at) from public.salon_customer_booking_requests where id=${r.bookingRequestId}`));};
 const target=b=>new Date(Date.parse(b.start)+100*86400000).toISOString();
 const move=(b,key,version=0,zone='Asia/Shanghai')=>`public.salon_reschedule_booking_with_time(1,1,1,${b.id},'${key}','${b.start}','${b.end}',0,'${target(b)}','合成','${zone}',${version})`;
 const proposal=(b,key,version=0,zone='Asia/Shanghai')=>`public.salon_customer_reschedule_with_time('${auth}',1,1,${b.id},'${key}','${b.start}','${b.end}',0,'${target(b)}','合成','${zone}',${version})`;
 const review=(id,key,version,zone='Asia/Shanghai')=>`public.salon_review_reschedule_with_time(1,1,1,${id},'${key}','approved','合成','${zone}',${version})`;
 const state=b=>app.sql(`select starts_at||'/'||reschedule_version from public.salon_customer_booking_requests where id=${b.id}`);
 const version=()=>Number(app.sql('select timezone_version from public.salon_stores where id=1'));
 const change=zone=>app.sql(`update public.salon_stores set timezone='${zone}' where id=1`);
 const waitSleeping=async name=>{for(let i=0;i<100;i++){if(app.sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`)==='1')return;await new Promise(r=>setTimeout(r,20));}throw Error('test transaction never reached barrier');};
 const b=booking(),old=state(b);change('America/New_York');change('Asia/Shanghai');assert.equal(version(),2);
 fails(move(b,'tz-stale-move-0001'),/时区版本已变化/);assert.equal(state(b),old);assert.equal(app.sql('select count(*) from public.salon_time_context_requests'),'0');
 app.sql('update public.salon_stores set timezone_version=0 where id=1');assert.equal(version(),2);
 const key='tz-success-move-001',result=call(move(b,key,2));change('America/New_York');assert.deepEqual(call(move(b,key,2)),result);fails(move(b,key,3,'America/New_York'),/幂等键/);
 // Same key concurrent customer proposal; original successful result remains replayable after config change.
 const c=booking(),v=version(),pkey='tz-proposal-same-01',q=proposal(c,pkey,v,'America/New_York');
 const concurrent=await Promise.all([app.asyncSql(`set role service_role;select ${q}`),app.asyncSql(`set role service_role;select ${q}`)]);assert.equal(concurrent[0],concurrent[1]);const id=JSON.parse(concurrent[0]).changeRequestId;
 change('Asia/Shanghai');assert.deepEqual(call(q),JSON.parse(concurrent[0]));fails(review(id,'tz-review-stale-001',v,'America/New_York'),/时区版本已变化/);assert.equal(app.sql(`select status from public.salon_booking_change_requests where id=${id}`),'submitted');call(review(id,'tz-review-current01',version()));
 // New configuration wins before submission: writer waits then sees new version, no write.
 const d=booking(),before=state(d),dv=version();
 const configTx=app.asyncSql("set application_name='tz-config-barrier';begin;update public.salon_stores set timezone='America/New_York' where id=1;select pg_sleep(2);commit;");
 await waitSleeping('tz-config-barrier');
 const rejected=app.asyncSql(`set role service_role;select ${move(d,'tz-concurrent-old01',dv)};`).then(()=>({ok:true}),e=>({error:String(e.stderr)}));
 await configTx;assert.match((await rejected).error,/时区版本已变化/);assert.equal(state(d),before);
 // Business transaction wins: store lock prevents config UPDATE until business COMMIT.
 const e=booking(),ev=version();
 const businessTx=app.asyncSql(`set application_name='tz-business-barrier';begin;set local role service_role;select ${move(e,'tz-business-lock01',ev,'America/New_York')};select pg_sleep(2);commit;`);
 await waitSleeping('tz-business-barrier');
 await assert.rejects(app.asyncSql("set lock_timeout='150ms';update public.salon_stores set timezone='Asia/Shanghai' where id=1"),err=>/lock timeout/.test(err.stderr));await businessTx;
 assert.equal(version(),ev);assert.notEqual(state(e),e.start+'/0');
 // Underlying business failure rolls the time guard back as well.
 const f=booking();app.sql(`insert into public.salon_schedule_blocks(organization_id,store_id,staff_id,block_type,starts_at,ends_at) values(1,1,1,'leave','${target(f)}','${target(f)}'::timestamptz+interval '1 hour')`);
 fails(move(f,'tz-conflict-rollback',ev,'America/New_York'),/新档期与预约或休假冲突/);assert.equal(app.sql("select count(*) from public.salon_time_context_requests where request_key='tz-conflict-rollback'"),'0');
 app.sql("delete from public.salon_role_permissions where role_id=1 and resource='scheduling' and action='write'");fails(move(b,key,2),/权限/);
 for(const role of ['anon','authenticated'])assert.equal(app.sql(`select has_table_privilege('${role}','public.salon_time_context_requests','SELECT')`),'f');
 console.log('Time transactions passed: ABA versions, stale rejection, post-change replay, full fingerprint, same-key concurrency, config-first/business-first races, rollback and revoked permissions');
}finally{if(app)await app.close();}})().catch(e=>{console.error(e);process.exitCode=1});
