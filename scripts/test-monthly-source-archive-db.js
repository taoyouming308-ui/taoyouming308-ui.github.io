'use strict';
// Real PG17; synthetic-only, network-isolated disposable container. No project access.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync,spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const container='monthly-source-'+process.pid+'-'+Date.now(),q=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
const docker=args=>spawnSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024}),check=r=>{if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim();};
const sqlRaw=input=>spawnSync('docker',['exec','-i',container,'psql','-h','127.0.0.1','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',maxBuffer:8*1024*1024}),sql=s=>check(sqlRaw(s)),json=s=>JSON.parse(sql(s).split('\n').at(-1));
const asyncSql=input=>new Promise(resolve=>{const p=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres']);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',status=>resolve({status,stdout:out,stderr:err}));p.stdin.end(input);});
const C=randomUUID(),S=randomUUID(),A=randomUUID(),B=randomUUID(),R=randomUUID(),m={original_filename:'synthetic.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size_bytes:123,sha256:'a'.repeat(64),worksheet_names:['7月','8月 ','9月'],bucket_id:'zysyr-reports'};
const rpc=(action,id=R,metadata={},actor=A,store=S)=>`select public.zysyr_monthly_source_archive('${actor}','${C}','${store}',${q(action)},${id?q(id):'null'},${j(metadata)});`;
const fail=(s,re)=>{const r=sqlRaw(s);assert.notEqual(r.status,0);assert.match(r.stderr,re);};
const bindings=[{period_month:'2026-07-01',worksheet_name:'7月'},{period_month:'2026-08-01',worksheet_name:'8月 '},{period_month:'2026-09-01',worksheet_name:'9月'}];
const selectMeta=(previous={})=>({source_request_id:R,expected_source_sha256:m.sha256,bindings,expected_previous_selection_ids:Object.fromEntries(bindings.map(b=>[b.period_month,previous[b.period_month]||null])),reason:'explicit synthetic source selection'});
let started=false;
(async()=>{try{
 check(docker(['run','--rm','-d','--network','none','--name',container,'-e','POSTGRES_PASSWORD=synthetic','postgres:17']));started=true;
 for(let i=0;i<100;i++){if(docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0)break;await new Promise(r=>setTimeout(r,100));}
 sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;
 create table public.synthetic_accounts(id uuid primary key,company_id uuid,store_id uuid,active boolean,can_write boolean,can_read boolean);
 insert into synthetic_accounts values('${A}','${C}','${S}',true,true,true),('${B}','${C}','${S}',true,true,true);
 create function zysyr_private.account_has_capability(a uuid,c uuid,s uuid,cap text) returns boolean language sql stable as $$ select exists(select 1 from public.synthetic_accounts where id=a and company_id=c and store_id=s and active and case when cap='dashboard.store.read' then can_read else can_write end) $$;
 create function zysyr_private.assert_finance_scope(a uuid,c uuid,s uuid,cap text) returns void language plpgsql as $$begin if not zysyr_private.account_has_capability(a,c,s,cap) then raise exception using errcode='42501',message='FINANCE_SCOPE_FORBIDDEN';end if;end$$;
 create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table public.synthetic_financial(id int,amount numeric,source_id uuid,status text);insert into synthetic_financial values(1,123.45,null,'posted'),(2,0,null,'draft');`);
 const before=sql('select md5(jsonb_agg(to_jsonb(f))::text) from synthetic_financial f');
 const file=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_monthly_source_archive.sql'));sql(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 for(const t of ['reservations','completions','selections']){
  const name='zysyr_monthly_source_'+t;
  assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid='${name}'::regclass`),'t');
  for(const role of ['anon','authenticated','service_role'])for(const op of [`select * from ${name}`,`delete from ${name}`])fail(`set role ${role};${op}`,/permission denied/);
 }
 for(const role of ['anon','authenticated'])fail(`set role ${role};`+rpc('reserve',R,m),/permission denied/);
 assert.equal(json('set role service_role;'+rpc('reserve',R,m)).newly_reserved,true);
 assert.equal(json(rpc('reserve',R,m)).newly_reserved,false);
 fail(rpc('reserve',R,{...m,size_bytes:124}),/BINDING_MISMATCH/);
 fail(rpc('reserve',randomUUID(),m,B),/MONTHLY_SOURCE_PENDING/);
 fail(rpc('status',R,{},A,randomUUID()),/FINANCE_SCOPE_FORBIDDEN/);
 assert.equal(json(rpc('complete',R,m)).status,'archived');
 const canonical=json(rpc('reserve',randomUUID(),{...m,original_filename:'same-bytes.xlsx'},B));assert.equal(canonical.request_id,R);assert.equal(canonical.status,'archived');
 assert.equal(json(rpc('status',R,{},B)).status,'archived','completed shared source can be checked after canonical hash reuse');
 assert.equal(sql('select count(*) from zysyr_monthly_source_reservations'),'1');
 const sel=randomUUID(),s1=json(rpc('select',sel,selectMeta()));assert.equal(s1.selections.length,3);assert.equal(s1.selections[1].worksheet_name,'8月 ');
 assert.equal(json(rpc('select',sel,selectMeta())).selections[0].id,s1.selections[0].id);
 assert.equal(json(rpc('selection_status',sel)).status,'selected');fail(rpc('selection_status',sel,{},B),/REQUEST_SCOPE_MISMATCH/);
 fail(rpc('select',sel,{...selectMeta(),reason:'changed'}),/BINDING_MISMATCH/);
 fail(rpc('select',randomUUID(),selectMeta()),/SELECTION_CONFLICT/);assert.equal(sql('select count(*) from zysyr_monthly_source_selections'),'3');
 const previous=Object.fromEntries(s1.selections.map(s=>[s.period_month,s.id]));
 const wrong=selectMeta(previous);wrong.bindings=[...bindings.slice(0,1),{...bindings[1],worksheet_name:'8月'},bindings[2]];fail(rpc('select',randomUUID(),wrong),/BINDING_INVALID/);
 const partial=selectMeta(previous);partial.expected_previous_selection_ids['2026-09-01']=null;fail(rpc('select',randomUUID(),partial),/SELECTION_CONFLICT/);assert.equal(sql('select count(*) from zysyr_monthly_source_selections'),'3','three-month rollback is atomic');
 const responses=await Promise.all([randomUUID(),randomUUID()].map(id=>asyncSql('begin;'+rpc('select',id,selectMeta(previous))+'select pg_sleep(0.2);commit;')));
 assert.equal(responses.filter(r=>r.status===0).length,1);assert.match(responses.find(r=>r.status!==0).stderr,/SELECTION_CONFLICT/);
 assert.equal(sql('select count(*) from zysyr_monthly_source_selections'),'6');assert.equal(json(rpc('selection_status',sel)).selections.every(s=>!s.is_current),true,'old receipt remains available but no longer current');
 const current=json(rpc('list',null,{month:'2026-08',offset:0}));assert.equal(current.current_selection.selection_version,2);assert.equal(current.selections.length,2);assert.equal(current.sources.length,1);
 for(const t of ['reservations','completions','selections']){fail(`update zysyr_monthly_source_${t} set created_at=now()`,/IMMUTABLE/);fail(`delete from zysyr_monthly_source_${t}`,/IMMUTABLE/);}
 sql(`update synthetic_accounts set can_write=false where id='${A}'`);fail(rpc('status'),/FINANCE_SCOPE_FORBIDDEN/);assert.equal(json(rpc('view')).status,'archived');
 sql(`update synthetic_accounts set active=false where id='${A}'`);fail(rpc('list',null,{month:'2026-08'}),/READ_FORBIDDEN/);sql(`update synthetic_accounts set active=true,can_write=true where id='${A}'`);
 const latest={};for(const b of bindings)latest[b.period_month]=json(rpc('list',null,{month:b.period_month.slice(0,7)})).current_selection.id;
 const held=asyncSql(`begin;select pg_advisory_xact_lock(hashtextextended('${C}/${S}/monthly-source-selection',0));select pg_sleep(1);update synthetic_accounts set can_write=false where id='${A}';commit;`);
 await new Promise(r=>setTimeout(r,150));const revoked=await asyncSql(rpc('select',randomUUID(),selectMeta(latest)));await held;assert.notEqual(revoked.status,0);assert.match(revoked.stderr,/FINANCE_SCOPE_FORBIDDEN/);assert.equal(sql('select count(*) from zysyr_monthly_source_selections'),'6');
 sql(`update synthetic_accounts set can_write=true where id='${A}'`);
 const boundaryMeta=n=>({...selectMeta(),bindings:Array.from({length:n},(_,i)=>({period_month:`2028-${String(i+1).padStart(2,'0')}-01`,worksheet_name:'7月'})),expected_previous_selection_ids:Object.fromEntries(Array.from({length:n},(_,i)=>[`2028-${String(i+1).padStart(2,'0')}-01`,null]))});
 const single=boundaryMeta(1);single.bindings[0].period_month='2027-01-01';single.expected_previous_selection_ids={'2027-01-01':null};assert.equal(json(rpc('select',randomUUID(),single)).selections.length,1);
 assert.equal(json(rpc('select',randomUUID(),boundaryMeta(12))).selections.length,12);
 for(const count of [0,13])fail(rpc('select',randomUUID(),boundaryMeta(count)),/SELECTION_INVALID/);
 assert.equal(sql('select count(*) from zysyr_monthly_source_selections'),'19');
 assert.equal(sql('select md5(jsonb_agg(to_jsonb(f))::text) from synthetic_financial f'),before);
 console.log('Monthly source PG17: ACL/RLS, immutable evidence, scope/revocation, hash reuse, exact request replay, original sheet names, three-month rollback/concurrency and financial sentinel preservation passed.');
}finally{if(started)docker(['rm','-f',container]);}})().catch(e=>{console.error(e);process.exitCode=1;});
