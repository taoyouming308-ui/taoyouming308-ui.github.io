// Synthetic isolated PostgreSQL only; tmpfs, no network, no anonymous volumes.
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
execFileSync(process.execPath,['scripts/build-daily-autofill-v2.mjs','--check'],{stdio:'pipe'});
const name=`daily-autofill-${process.pid}-${Date.now()}`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
const sql=query=>docker(['exec','-i',name,'psql','-X','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1', '-c',query]).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const json=query=>JSON.parse(sql(query).split('\n').at(-1));
const company='02463a53-dfdb-4291-b04d-dd1d85f9d998',free='ea7e281f-a254-4664-bb03-cf1acf48d79d',xiang='8d057980-ff8f-4b2c-9c7f-4dd23a568f35';
const actor='00000000-0000-4000-8000-000000000009';
const day='2026-09-27';
const base=JSON.parse(execFileSync('/usr/bin/python3',['-c','import json;from scripts.test_mgj_business_detail import normalized;print(json.dumps(normalized()))'],{encoding:'utf8'}));
function payload(shop='向里造型',date=day,fee=10000){
 const bill=structuredClone(base);bill.business_date=date;bill.shop_id=shop==='向里造型'?'1837032':'1009951';
 bill.source_posted_amount_cents=10000;bill.items=[{...bill.items[0],source_item_id:'7',item_name:'健康烫发980',amount_cents:10000}];
 bill.employee_allocations=[{...bill.employee_allocations[0],employee_id:'11',employee_name:'合成发型师',source_item_id:'7',source_role:'设计师',performance_cents:fee,source_project_count:1},
  {...bill.employee_allocations[0],source_allocation_id:'8',employee_id:'22',employee_name:'合成技师',source_item_id:'7',source_role:'C级技师',performance_cents:9000,source_project_count:2}];
 bill.payments=bill.payments.map(p=>({...p,amount_cents:p.source_field==='pay'?10000:0,known:true,source_label:({pay:'支付宝',weixin:'微信',dianpin:'大众点评'})[p.source_field]||''}));
 return {contract_version:'mgj-business-day-v1',shop_id:bill.shop_id,business_date:date,source_scope:'project_consumption',bills:[bill]};
}
const ingest=(p,shop='向里造型')=>json(`set role service_role;select public.mgj_ingest_business_details(${q(shop)},${q(p.business_date)},now(),${q(JSON.stringify(p))}::jsonb);`);
const autofill=(shop='向里造型',date=day)=>json(`set role service_role;select public.mgj_autofill_daily_sheet(${q(shop)},${q(date)});`);
const list=(shop='向里造型',date=day)=>sql(`insert into public.mgj_daily_consumption values(${q(shop)},${q(date)},'[ {"source_id":"42","amount":100} ]') on conflict(shop_name,business_date) do update set services=excluded.services;`);
const value=(column,section='stylist',label='合成发型师')=>sql(`select coalesce(ocr_numeric::text,'NULL') from public.zysyr_daily_sheet_cells where draft_id=(select id from public.zysyr_daily_sheet_drafts where store_id='${xiang}' and report_date='${day}') and column_code=${q(column)} and section_code=${q(section)} and row_label=${q(label)};`);
let checks=0;const check=(label,fn)=>{fn();console.log(`ok ${++checks} - ${label}`);};
let started=false;
(async()=>{try{
 docker(['run','--rm','-d','--network','none','--name',name,'--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
 let ready=false;for(let n=0;n<80;n++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
 assert(JSON.parse(docker(['inspect','--format','{{json .Mounts}}',name])).every(m=>m.Type!=='volume'));
 sql(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema zysyr_private;create schema zysyr_daily_electronic_private;
 create table public.zysyr_daily_sheet_drafts(id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,
  report_date date not null,status text not null default 'draft',template_code text not null default 'zysyr_daily_performance_photo',source_voucher_id uuid,source_sha256 text,ocr_provider text not null,ocr_model text not null,
  ocr_raw_result jsonb not null default '{}',validation_result jsonb not null default '{}',edit_revision int not null default 0,
  created_by_user_id uuid not null,updated_by_user_id uuid not null,updated_at timestamptz not null default now(),unique(company_id,store_id,id));
 create table public.zysyr_daily_sheet_cells(id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,draft_id uuid not null,
  section_code text not null,row_key text not null,row_label text not null,column_code text not null,column_label text not null,
  row_number int not null,column_number int not null,cell_role text not null,ocr_text text,ocr_numeric numeric(14,2) check(ocr_numeric>=0),
  corrected_numeric numeric,manual_override boolean not null default false,manual_text text,row_label_source_method text not null default 'template',
  source_method text not null constraint zysyr_daily_sheet_cells_source_method_check check(source_method in('blank_template','codex_local_candidate')),
  updated_by_user_id uuid not null,updated_at timestamptz not null default now(),unique(company_id,draft_id,section_code,row_key,column_code));
 create table public.zysyr_daily_sheet_attachments(id uuid default gen_random_uuid(),draft_id uuid);
 create table public.zysyr_daily_sheet_cell_changes(draft_id uuid,cell_id uuid references public.zysyr_daily_sheet_cells(id) on delete restrict);
 create table public.test_locks(store_id uuid,report_date date);
 create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select exists(select 1 from public.test_locks where store_id=$2 and report_date=$3)$$;
 create function zysyr_daily_electronic_private.protect_daily_electronic_evidence() returns trigger language plpgsql as $$begin raise exception 'DAILY_ELECTRONIC_EVIDENCE_IMMUTABLE';end$$;
 revoke all on schema zysyr_private,zysyr_daily_electronic_private from public,anon,authenticated,service_role;
 create table public.mgj_daily_consumption(shop_name text,business_date date,services jsonb,primary key(shop_name,business_date));
 create table public.legacy_income(id int,amount numeric);insert into public.legacy_income values(1,2126);
 ${fs.readFileSync('supabase/migrations/20260927210938_mgj_frontdesk_business_detail_snapshots.sql','utf8')}
 ${fs.readFileSync('supabase/migrations/20260928005448_zysyr_frontdesk_daily_autofill.sql','utf8')}`);
 check('only fixed machine writer, no client or private schema/table access',()=>{
  for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};select public.mgj_autofill_daily_sheet('向里造型','${day}');`),/permission denied/);
  assert.throws(()=>sql(`select public.mgj_autofill_daily_sheet('向里造型','${day}');`),/AUTOFILL_SERVICE_REQUIRED/);
  assert.throws(()=>sql(`set role service_role;select public.mgj_autofill_daily_sheet('其他门店','${day}');`),/AUTOFILL_SCOPE_INVALID/);
  assert.throws(()=>autofill('向里造型','2025-12-31'),/AUTOFILL_SCOPE_INVALID/);
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_table_privilege('${role}','public.zysyr_daily_autofill_events','SELECT');`),'f');
  assert.equal(sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.zysyr_daily_autofill_events'::regclass"),'t');
 });
 check('missing source creates no false zero report',()=>assert.equal(autofill().status,'source_unavailable_or_changed'));
 list();ingest(payload());
 check('verified source-head update automatically creates real persisted draft',()=>{
  assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_drafts where store_id='${xiang}' and report_date='${day}'`),'1');
  assert.equal(value('perm'),'100.00');assert.equal(value('perm_count','technician','合成技师'),'2.00');
  assert.equal(value('subtotal','technician','合成技师'),'2.00');assert.equal(value('subtotal'),'100.00');
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_drafts where created_by_user_id is null and status='draft'"),'1');
 });
 check('known payment channels exact; no technician money or guessed grand total',()=>{
  assert.equal(value('alipay','payment','支付'),'100.00');assert.equal(value('care_count','technician','合成技师'),'0.00','complete classified source proves absence, not missing data');
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_cells where column_code in('grand_total','cash_flow','card_consumption','actual_total') and ocr_numeric is not null"),'0');
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_cells where section_code='technician' and column_code not in('perm_count','dye_count','care_count','subtotal')"),'0');
 });
 const draft=sql(`select id from public.zysyr_daily_sheet_drafts where store_id='${xiang}' and report_date='${day}'`);
 check('idempotent same snapshot leaves revision/audit unchanged',()=>{assert.equal(autofill().status,'already_applied');ingest(payload());assert.equal(sql(`select edit_revision from public.zysyr_daily_sheet_drafts where id='${draft}'`),'1');assert.equal(sql('select count(*) from public.zysyr_daily_autofill_events'),'1');});
 check('authorized unposted source fields replace manual overrides with before-image',()=>{
  sql(`update public.zysyr_daily_sheet_cells set manual_override=true,corrected_numeric=777 where draft_id='${draft}' and column_code='perm' and section_code='stylist' and cell_role='staff_value';
   update public.zysyr_daily_sheet_cells set manual_override=true,corrected_numeric=null where draft_id='${draft}' and column_code='alipay';`);
  ingest(payload('向里造型',day,20000));
  assert.equal(sql(`select manual_override from public.zysyr_daily_sheet_cells where draft_id='${draft}' and column_code='perm' and cell_role='staff_value'`),'f');
  assert.equal(value('perm'),'200.00');
  assert.equal(value('alipay','payment','支付'),'100.00');
  assert.equal(sql(`select count(*) from public.zysyr_daily_autofill_events e cross join lateral jsonb_array_elements(e.before_snapshot->'cells')c where e.draft_id='${draft}' and c->>'corrected_numeric'='777'`),'1');
  assert.equal(value('subtotal'),'200.00');
 });
 check('A to B to A source reversion is applied, not falsely deduplicated',()=>{ingest(payload());assert.equal(value('subtotal'),'100.00');assert.equal(sql(`select edit_revision from public.zysyr_daily_sheet_drafts where id='${draft}'`),'3');});
 check('stable employee keys do not reassign rows to newly sorted employee',()=>{
  const originalKey=sql(`select row_key from public.zysyr_daily_sheet_cells where draft_id='${draft}' and column_code='perm' and cell_role='staff_value'`);
  const p=payload();p.bills[0].employee_allocations.push({...p.bills[0].employee_allocations[0],source_allocation_id:'9',employee_id:'1',employee_name:'新合成员工',performance_cents:1000});ingest(p);
  assert.equal(sql(`select row_label from public.zysyr_daily_sheet_cells where draft_id='${draft}' and row_key=${q(originalKey)} and column_code='perm'`),'合成发型师');
 });
 check('unknown projects/counts and changed payment labels stay unknown',()=>{
  const p=payload();p.bills[0].items[0].item_name='褪色';p.bills[0].employee_allocations[1].source_project_count=null;
  p.bills[0].payments.find(r=>r.source_field==='pay').source_label='其他渠道';ingest(p);
  assert.equal(value('perm_count','technician','合成技师'),'NULL');assert.equal(value('care_count','technician','合成技师'),'NULL');
 });
 check('January standard: single platform performance not counted again by project; mixed payment stays review',()=>{
  const p=payload();p.bills[0].items[0].item_name='洗吹98元';
  p.bills[0].payments.find(r=>r.source_field==='pay').amount_cents=0;
  p.bills[0].payments.find(r=>r.source_field==='dianpin').amount_cents=10000;ingest(p);
  assert.equal(value('dianping_group'),'100.00');assert.equal(value('makeup_styling'),'0.00');assert.equal(value('wash_cut_blow'),'0.00');
  p.bills[0].payments.find(r=>r.source_field==='pay').amount_cents=1000;ingest(p);
  assert.equal(value('dianping_group'),'NULL');assert.equal(value('makeup_styling'),'NULL');
  p.bills[0].payments.find(r=>r.source_field==='dianpin').amount_cents=0;ingest(p);
  assert.equal(value('makeup_styling'),'100.00');
 });
 check('both stores isolated; wholly empty template pre-image recoverable',()=>{
  list('自由手艺人');sql(`insert into public.zysyr_daily_sheet_drafts(company_id,store_id,report_date,ocr_provider,ocr_model,created_by_user_id,updated_by_user_id)values('${company}','${free}','${day}','manual-entry','manual-entry-v1','${actor}','${actor}');`);
  const freeDraft=sql(`select id from public.zysyr_daily_sheet_drafts where store_id='${free}'`);
  sql(`insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,updated_by_user_id)values('${company}','${free}','${freeDraft}','stylist','stylist_1','第1行','perm','烫',3,2,'staff_value','blank_template','${actor}');`);
  ingest(payload('自由手艺人'),'自由手艺人');assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_drafts where report_date='${day}'`),'2');
  assert.equal(sql(`select before_snapshot->'cells'->0->>'row_label' from public.zysyr_daily_autofill_events where draft_id='${freeDraft}'`),'第1行');
  assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cells where draft_id='${freeDraft}' and row_key='stylist_1'`),'1','old cell ID/history retained, not deleted');
  assert.equal(sql(`select ocr_raw_result->'autofill'->'active_staff_row_keys' ? 'stylist_1' from public.zysyr_daily_sheet_drafts where id='${freeDraft}'`),'f');
 });
 check('confirmed preserved; authorized manual/image drafts updated without removing evidence',()=>{
  for(const [date,status,provider,revision] of [['2026-09-24','confirmed','manual-entry',0],['2026-09-25','draft','manual-entry',1],['2026-09-26','draft','manual-entry',0]]){
   list('向里造型',date);sql(`insert into public.zysyr_daily_sheet_drafts(company_id,store_id,report_date,status,ocr_provider,ocr_model,edit_revision,created_by_user_id,updated_by_user_id)values('${company}','${xiang}','${date}','${status}','${provider}','manual-entry-v1',${revision},'${actor}','${actor}');`);
   if(date==='2026-09-26')sql(`insert into public.zysyr_daily_sheet_attachments(draft_id)select id from public.zysyr_daily_sheet_drafts where report_date='${date}'`);
   if(date==='2026-09-25')sql(`insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,ocr_numeric,manual_override,corrected_numeric,updated_by_user_id)select '${company}','${xiang}',id,'stylist','stylist_1','原人工员工','perm','烫发',3,2,'staff_value','blank_template',10,true,777,'${actor}' from public.zysyr_daily_sheet_drafts where report_date='${date}';insert into public.zysyr_daily_sheet_cell_changes(draft_id,cell_id) select draft_id,id from public.zysyr_daily_sheet_cells where row_label='原人工员工';`);
   ingest(payload('向里造型',date));assert.equal(sql(`select ocr_model from public.zysyr_daily_sheet_drafts where report_date='${date}'`),status==='confirmed'?'manual-entry-v1':'frontdesk-autofill-v1');
   if(date==='2026-09-26')assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_attachments a join public.zysyr_daily_sheet_drafts d on d.id=a.draft_id where d.report_date='${date}'`),'1');
   if(date==='2026-09-25'){
    assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cell_changes h join public.zysyr_daily_sheet_cells c on c.id=h.cell_id`),'1','cell IDs/history not removed');
    assert.equal(sql(`select count(*) from public.zysyr_daily_autofill_events e cross join lateral jsonb_array_elements(e.before_snapshot->'cells')c where c->>'row_label'='原人工员工' and c->>'corrected_numeric'='777'`),'1','original manual amount archived exactly');
   }
  }
 });
 check('locked period and stale live list cannot create/fill',()=>{
  list('向里造型','2026-09-23');sql(`insert into public.test_locks values('${xiang}','2026-09-23')`);ingest(payload('向里造型','2026-09-23'));
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_drafts where report_date='2026-09-23'"),'0');
  sql(`update public.mgj_daily_consumption set services='[{"source_id":"42","amount":101}]' where shop_name='向里造型' and business_date='${day}'`);
  assert.equal(autofill().status,'source_unavailable_or_changed');
 });
 check('immutable exact before/after evidence, no ledger or automatic confirmation',()=>{
  assert.throws(()=>sql('delete from public.zysyr_daily_autofill_events'),/IMMUTABLE/);
  assert.throws(()=>sql("update public.zysyr_daily_autofill_events set review_gaps='[]'"),/IMMUTABLE/);
  assert.equal(sql('select amount from public.legacy_income'),'2126');
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_drafts where ocr_model='frontdesk-autofill-v1' and status<>'draft'"),'0');
  assert.equal(sql("select bool_and((validation_result->>'valid')::boolean=false) from public.zysyr_daily_sheet_drafts where ocr_model='frontdesk-autofill-v1'"),'t');
 });
 check('unexpected draft failure recorded durably without rejecting valid shared source',()=>{
  list('向里造型','2026-09-22');
  sql(`create function public.synthetic_draft_failure() returns trigger language plpgsql as $$begin if new.report_date='2026-09-22' then raise exception 'synthetic_failure';end if;return new;end$$;create trigger synthetic_draft_failure before insert on public.zysyr_daily_sheet_drafts for each row execute function public.synthetic_draft_failure();`);
  assert.equal(ingest(payload('向里造型','2026-09-22')).accepted,true);
  assert.equal(sql("select result->>'status' from public.zysyr_daily_autofill_status where shop_name='向里造型' and business_date='2026-09-22'"),'failed');
  assert.equal(sql("select count(*) from public.zysyr_daily_sheet_drafts where report_date='2026-09-22'"),'0');
  assert.equal(sql("select count(*) from public.mgj_business_detail_heads where business_date='2026-09-22'"),'1');
 });
 sql(fs.readFileSync('supabase/migrations/20260928084952_zysyr_daily_autofill_precise_v2.sql','utf8'));
 check('v2 catalog exactly matches shared frontdesk routes, unknown names fail closed',()=>{
  const catalog=JSON.parse(execFileSync('node',['--input-type=module','-e',"import {REPORT_PROJECT_ROUTES as r} from './supabase/functions/_shared/salon-report-catalog.mjs';console.log(JSON.stringify(r))"],{encoding:'utf8'}));
  for(const [shop,code,name,category] of catalog)assert.equal(sql(`select zysyr_daily_electronic_private.report_project_category(${q(shop)},${q(code)},${q(name)})`),category);
  assert.equal(sql("select coalesce(zysyr_daily_electronic_private.report_project_category('1837032','324','改名不明产品'),'NULL')"),'NULL');
 });
 check('v1 same-snapshot upgrade runs once, stable cell IDs and confirmation guards survive',()=>{
  list();
  const p=payload();p.bills[0].items[0].item_code='324';ingest(p);
  assert.equal(sql(`select ocr_model from public.zysyr_daily_sheet_drafts where id='${draft}'`),'frontdesk-autofill-v2');
  const revision=sql(`select edit_revision from public.zysyr_daily_sheet_drafts where id='${draft}'`);
  assert.equal(autofill().status,'already_applied');assert.equal(sql(`select edit_revision from public.zysyr_daily_sheet_drafts where id='${draft}'`),revision);
  assert.equal(autofill('向里造型','2026-09-24').status,'confirmed_preserved');
  assert.equal(sql('select amount from public.legacy_income'),'2126');
 });
 check('mixed platform + cash: unique whole-item match reproduces January column convention',()=>{
  const p=payload(),b=p.bills[0];b.source_posted_amount_cents=20000;
  b.items=[{...b.items[0],item_code:'205',item_name:'剪发79',amount_cents:7000},{...b.items[0],source_item_id:'18',item_code:'311',item_name:'烫刘海400',amount_cents:13000}];
  b.employee_allocations=[{...b.employee_allocations[0],performance_cents:7000},{...b.employee_allocations[0],source_allocation_id:'19',source_item_id:'18',performance_cents:13000}];
  b.payments=b.payments.map(x=>({...x,amount_cents:x.source_field==='dianpin'?7000:x.source_field==='weixin'?13000:0}));
  sql(`update public.mgj_daily_consumption set services='[{"source_id":"42","amount":200}]' where shop_name='向里造型' and business_date='${day}'`);ingest(p);
  assert.equal(value('dianping_group'),'70.00');assert.equal(value('perm'),'130.00');assert.equal(value('subtotal'),'200.00');
  // Equal-value competing items cannot be disambiguated by amount alone.
  b.items[0].amount_cents=10000;b.items[1].amount_cents=10000;
  b.payments=b.payments.map(x=>({...x,amount_cents:['dianpin','weixin'].includes(x.source_field)?10000:0}));ingest(p);
  assert.equal(value('dianping_group'),'NULL');assert.equal(value('perm'),'NULL');
 });
 check('bleaching+dye counts one occasion, retains both performance amounts',()=>{
  list();const p=payload(),b=p.bills[0];
  b.items=[{...b.items[0],item_code:'427',item_name:'褪色',amount_cents:5000},{...b.items[0],source_item_id:'18',item_code:'439',item_name:'健康染699',amount_cents:5000}];
  b.employee_allocations=b.employee_allocations.map(x=>({...x,performance_cents:5000,source_project_count:1}));
  b.employee_allocations.push(...b.employee_allocations.map(x=>({...x,source_allocation_id:x.source_allocation_id+'second',source_item_id:'18'})));ingest(p);
  assert.equal(value('color'),'100.00');assert.equal(value('subtotal'),'100.00');
  assert.equal(value('dye_count','technician','合成技师'),'1.00');assert.equal(value('subtotal','technician','合成技师'),'1.00');
 });
 check('douyin payment channel not silently omitted; unknown label remains unknown',()=>{
  const p=payload();p.bills[0].items[0].item_code='324';
  p.bills[0].payments=p.bills[0].payments.map(x=>({...x,amount_cents:x.source_field==='otherfee2'?10000:0,source_label:x.source_field==='otherfee2'?'抖音':x.source_label}));ingest(p);
  assert.equal(value('douyin'),'100.00');assert.equal(value('douyin','payment','支付'),'100.00');
  p.bills[0].payments.find(x=>x.source_field==='otherfee2').source_label='其他新渠道';ingest(p);
  assert.equal(value('douyin','payment','支付'),'NULL');
 });
 check('v2 helpers are private, audit append-only and confirmed reports remain unaltered',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_function_privilege('${role}','zysyr_daily_electronic_private.platform_item_routes(jsonb)','EXECUTE')`),'f');
  assert.throws(()=>sql('delete from public.zysyr_daily_autofill_events'),/IMMUTABLE/);
  assert.equal(sql("select ocr_model from public.zysyr_daily_sheet_drafts where status='confirmed'"),'manual-entry-v1');
 });
 console.log(`Frontdesk automatic drafts: ${checks} safety groups passed`);
}finally{if(started)docker(['rm','-f','-v',name]);}})().catch(e=>{console.error(e.stderr||e);process.exitCode=1});
