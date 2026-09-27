#!/usr/bin/env node
// Isolated PostgreSQL 17, synthetic fixtures only. Never contacts a remote DB.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migrationName = '20260927173455_zysyr_daily_electronic_source_candidates.sql';
const migration = fs.readFileSync(path.join(root, 'supabase/migrations', migrationName), 'utf8');
const container = `zysyr-electronic-source-${process.pid}-${Date.now()}`;
const company = '02463a53-dfdb-4291-b04d-dd1d85f9d998';
const freeStore = 'ea7e281f-a254-4664-bb03-cf1acf48d79d';
const xiangStore = '8d057980-ff8f-4b2c-9c7f-4dd23a568f35';
const projects = 'projects_daily_summary';
const allBusiness = 'all_business_daily_summary';
const headers = ['日期','总额','现金','银联','支付宝','微信支付','大众点评','商场卡','合作券','口碑','抖音',
  '总额','划卡','划赠送金','划分期赠送金','总额','代金券','欠款','免单','红包','优惠券','商城订单','线上积分抵扣','门店积分抵扣'];
const tables = ['snapshots','candidates','heads','ingest_events'].map(name => `zysyr_daily_electronic_${name}`);
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 8*1024*1024 });
const psql = ['exec','-i',container,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'];
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const sql = query => execFileSync('docker', psql, { input: query, encoding: 'utf8', stdio: ['pipe','pipe','pipe'], maxBuffer: 8*1024*1024 }).trim();
const json = query => JSON.parse(sql(query).split('\n').filter(Boolean).at(-1));
const runSql = query => new Promise((resolve,reject) => {
  const child=spawn('docker',psql,{stdio:['pipe','pipe','pipe']}); let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(stdout):reject(new Error(stderr)));
  child.stdin.end(query);
});
const source = (day='2026-01-01', scope=projects, shop='1837032') => {
  const period=Date.parse(`${day}T00:00:00Z`);
  const row=[day,...Array(23).fill('0')]; row[1]='45';
  for(let index=2;index<=10;index++) row[index]=String(index-1);
  row[11]='60'; row[12]='10'; row[13]='20'; row[14]='30'; row[15]='36';
  for(let index=16;index<=23;index++) row[index]=String(index-15);
  return {shop_id:shop,business_date:day,
    query:{parentShopId:1103470,shopId:'1103470',shopIds:[shop],period:`${period}_${period}`,
      incomeType:scope===projects?['1']:['1','2','3','4','5'],depcode:'-1'},
    content:{head:headers.slice(),headTop:[{rowspan:'2',text:'日期'},{colspan:'10',text:'现金类'},
      {colspan:4,text:'划卡类'},{colspan:9,text:'其他非现类'}],data:[row],columns:Array(24).fill(null),config:{title:'门店营业日汇总'}}};
};
const call = (payload, options={}) => {
  const { companyId=company,storeId=xiangStore,day=payload.business_date,scope=projects,time='2026-01-02T00:00:00Z' }=options;
  return `select public.zysyr_ingest_daily_electronic_source(${q(companyId)}::uuid,${q(storeId)}::uuid,${q(day)}::date,${q(scope)},${q(time)}::timestamptz,${q(JSON.stringify(payload))}::jsonb);`;
};
const ingest = (payload,options) => json(`set role service_role; ${call(payload,options)}`);
const read = ({storeId=xiangStore,from='2026-01-01',to='2026-01-31',scope=null,id=null}={}) => json(`set role service_role;
  select public.zysyr_read_daily_electronic_source(${q(company)}::uuid,${q(storeId)}::uuid,${q(from)}::date,${q(to)}::date,
    ${scope===null?'null':q(scope)},${id===null?'null':`${q(id)}::uuid`});`);
let passed=0;
const check = (label,fn) => {fn(); passed++; console.log(`ok ${passed} - ${label}`);};
const rejects = (query,pattern) => assert.throws(()=>sql(query),error=>pattern.test(String(error.stderr||error.message)));
const malformed = (label,mutate,pattern=/DAILY_ELECTRONIC_/) => check(label,()=>{
  const payload=source(); mutate(payload); rejects(`set role service_role; ${call(payload)}`,pattern);
});

async function main(){
  let created=false;
  try {
    docker(['run','--rm','-d','--network','none','--name',container,
      '--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']); created=true;
    let ready=false;
    for(let attempt=0;attempt<80;attempt++){
      try {sql('select 1');ready=true;break;} catch {await new Promise(resolve=>setTimeout(resolve,250));}
    }
    assert(ready,'temporary PostgreSQL started');
    const mounts=JSON.parse(docker(['inspect','--format','{{json .Mounts}}',container]));
    assert(mounts.every(mount=>mount.Type!=='volume'),'test must not create anonymous volumes');
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema zysyr_private;
      create table public.zysyr_stores(company_id uuid,id uuid,primary key(company_id,id));
      insert into public.zysyr_stores values('${company}','${freeStore}'),('${company}','${xiangStore}');
      create table public.zysyr_daily_sheet_drafts(id integer,status text,amount numeric,original text);
      insert into public.zysyr_daily_sheet_drafts select i,'confirmed',i*11.25,'immutable-original-'||i from generate_series(1,41)i;
      insert into public.zysyr_daily_sheet_drafts values(42,'draft',null,'manual-explicit-blank');
      create table public.zysyr_income_records(id integer,amount numeric);
      insert into public.zysyr_income_records values(1,123.45);
      create table public.zysyr_period_locks(id integer,status text);
      insert into public.zysyr_period_locks values(1,'locked');
      ${migration}`);
    const legacyBefore=sql(`select jsonb_build_object('drafts',(select jsonb_agg(d order by id) from public.zysyr_daily_sheet_drafts d),
      'income',(select jsonb_agg(i) from public.zysyr_income_records i),'locks',(select jsonb_agg(l) from public.zysyr_period_locks l));`);
    check('RLS enabled/forced and no client/service direct table access',()=>{
      for(const table of tables){
        assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid='public.${table}'::regclass;`),'t');
        for(const role of ['anon','authenticated','service_role']){
          for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
            assert.equal(sql(`select has_table_privilege('${role}','public.${table}','${privilege}');`),'f');
          rejects(`set role ${role};select * from public.${table};`,/permission denied/);
        }
      }
    });
    check('only machine service role may call writer/reader/private core',()=>{
      for(const role of ['anon','authenticated']){
        rejects(`set role ${role};${call(source())}`,/permission denied/);
        rejects(`set role ${role};select public.zysyr_read_daily_electronic_source('${company}','${xiangStore}','2026-01-01','2026-01-01');`,/permission denied/);
      }
      rejects(call(source()),/DAILY_ELECTRONIC_SERVICE_REQUIRED/);
      rejects(`set role service_role; select zysyr_daily_electronic_private.daily_electronic_summary_candidate('${company}','${xiangStore}','2026-01-01','${projects}','{}');`,/permission denied/);
      assert.equal(sql("select has_schema_privilege('service_role','zysyr_private','usage');"),'f','no access to legacy private schema added');
    });
    const first=ingest(source());
    check('creates source-only candidate and computes hash in DB',()=>{
      assert.equal(first.inserted,true);assert.equal(first.latest,true);assert.equal(first.version,1);
      assert.equal(first.status,'needs_review');assert.equal(first.stage,'source_only');
      assert.equal(first.scope_verified,false);assert.equal(first.formal_ledger_amount_changed,false);
      assert.match(first.source_sha256,/^[0-9a-f]{64}$/);
      assert.equal(first.source_sha256,sql(`select encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') from public.zysyr_daily_electronic_snapshots where id='${first.snapshot_id}';`));
    });
    const detail=read({id:first.candidate_id}).items[0];
    check('raw source references/lineage are distinct from formal financial cells',()=>{
      const candidate=detail.candidate_payload; assert.equal(candidate.cells.length,27);
      assert.equal(candidate.cash_total_reference_cents,4500);
      assert.equal(candidate.financially_complete,false);assert.equal(candidate.automatic_posting_allowed,false);
      assert(candidate.controls.every(group=>group.matched===true&&group.delta_cents===0));
      assert.equal(candidate.cells[3].column_code,'alipay');assert.equal(candidate.cells[3].value_cents,300);
      assert.equal(candidate.cells[3].lineage.json_pointer,'/content/data/0/4');
      assert(candidate.cells.every(cell=>cell.formal_cell_target===null));
      assert(!candidate.cells.some(cell=>cell.column_code==='cash_flow'));
      assert.deepEqual(detail.source_payload,source());
    });
    check('four user-excluded account columns are null and nonblocking not_applicable',()=>{
      const excluded=detail.candidate_payload.cells.filter(cell=>cell.status==='not_applicable');
      assert.deepEqual(excluded.map(cell=>cell.column_code),['public_card','public_qr','private_card','private_qr']);
      assert(excluded.every(cell=>cell.value===null&&cell.value_cents===null&&cell.blocking===false));
      assert(!detail.gaps.some(gap=>/public_card|private_card|public_qr|private_qr/.test(gap.code)));
    });
    check('identical retry is idempotent with no duplicate audit event',()=>{
      const before=sql('select count(*) from public.zysyr_daily_electronic_ingest_events');
      const again=ingest(source());assert.equal(again.snapshot_id,first.snapshot_id);assert.equal(again.inserted,false);
      assert.equal(again.watermark_advanced,false);
      assert.equal(sql('select count(*) from public.zysyr_daily_electronic_ingest_events'),before);
    });
    check('same content newer timestamp moves watermark, not immutable fetched_at',()=>{
      const again=ingest(source(),{time:'2026-01-02T00:10:00Z'});
      assert.equal(again.snapshot_id,first.snapshot_id);assert.equal(again.watermark_advanced,true);
      assert.equal(Date.parse(again.fetched_at),Date.parse('2026-01-02T00:00:00Z'));
      assert.equal(Date.parse(again.latest_fetched_at),Date.parse('2026-01-02T00:10:00Z'));
    });
    check('unknown older content and same-timestamp different content fail closed',()=>{
      const changed=source();changed.content.data[0][1]='46';
      rejects(`set role service_role;${call(changed,{time:'2026-01-02T00:05:00Z'})}`,/DAILY_ELECTRONIC_STALE_SOURCE/);
      rejects(`set role service_role;${call(changed,{time:'2026-01-02T00:10:00Z'})}`,/DAILY_ELECTRONIC_SAME_TIME_CONFLICT/);
    });
    const newer=source();newer.content.data[0][1]='46';
    const second=ingest(newer,{time:'2026-01-02T00:20:00Z'});
    check('new content appends version; mismatched control preserved as gap',()=>{
      assert.equal(second.version,2);assert.notEqual(second.snapshot_id,first.snapshot_id);
      const view=read({id:second.candidate_id}).items[0];
      assert.equal(view.controls[0].delta_cents,100);assert.equal(view.controls[0].matched,false);
      assert(view.gaps.some(gap=>gap.code==='source_group_mismatch'));
      const old=read({id:first.candidate_id}).items[0];assert.equal(old.latest,false);
      assert.deepEqual(old.source_payload,source());
    });
    check('late known retry does not replace current source',()=>{
      const late=ingest(source());assert.equal(late.snapshot_id,first.snapshot_id);assert.equal(late.latest,false);
      assert.equal(late.watermark_advanced,false);assert.equal(read().items[0].snapshot_id,second.snapshot_id);
    });
    const all=ingest(source('2026-01-01',allBusiness),{scope:allBusiness});
    check('all-business/project scopes have independent heads and explicit income gap',()=>{
      assert.equal(all.version,1);assert.equal(read().items.length,2);
      const view=read({id:all.candidate_id,scope:allBusiness}).items[0];
      assert(view.gaps.some(gap=>gap.code==='all_business_total_is_not_cash_performance'));
      assert(!view.candidate_payload.cells.some(cell=>cell.column_code==='cash_flow'));
    });
    check('unknown blank/null fields are not zero, group delta remains unknown',()=>{
      const blank=source('2026-01-02');blank.content.data[0][4]='';blank.content.data[0][5]=null;
      const receipt=ingest(blank,{time:'2026-01-03T00:00:00Z'});
      const view=read({id:receipt.candidate_id}).items[0];
      assert.equal(view.candidate_payload.cells[3].value,null);assert.equal(view.candidate_payload.cells[3].status,'unknown');
      assert.equal(view.controls[0].delta_cents,null);assert.equal(view.controls[0].matched,null);
      assert.equal(view.controls[0].unknown_count,2);assert(view.gaps.some(gap=>gap.code==='source_fields_unknown'));
    });
    check('explicit zero source stays reference-only, never closed-business/confirmed',()=>{
      const zero=source('2026-01-03');zero.content.data[0]=['2026-01-03',...Array(23).fill('0')];
      const receipt=ingest(zero,{time:'2026-01-04T00:00:00Z'});
      const view=read({id:receipt.candidate_id}).items[0];assert.equal(view.cash_total_reference_cents,0);
      assert.equal(view.status,'needs_review');assert.equal(view.candidate_payload.financially_complete,false);
    });
    malformed('rejects no row instead of inventing zero',s=>s.content.data=[],/DAILY_ELECTRONIC_SOURCE_NO_ROWS/);
    malformed('rejects duplicate days',s=>s.content.data.push(s.content.data[0]),/DAILY_ELECTRONIC_SUMMARY_MULTIPLE_ROWS/);
    malformed('rejects wrong source date',s=>s.content.data[0][0]='2026-01-02',/DAILY_ELECTRONIC_SUMMARY_DATE_MISMATCH/);
    malformed('rejects cross-store body',s=>s.shop_id='1009951',/DAILY_ELECTRONIC_SOURCE_ENVELOPE_INVALID/);
    malformed('rejects cross-store query',s=>s.query.shopIds=['1009951'],/DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH/);
    malformed('rejects multi-store query',s=>s.query.shopIds.push('1009951'),/DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH/);
    malformed('rejects incorrect period convention',s=>s.query.period='0_0',/DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH/);
    malformed('rejects mismatched scope/categories',s=>s.query.incomeType=['1','2'],/DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH/);
    malformed('rejects department-filtered incomplete source',s=>s.query.depcode='1',/DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH/);
    malformed('rejects uploaded derived candidates',s=>s.calculated={cash_flow:999},/DAILY_ELECTRONIC_SOURCE_ENVELOPE_INVALID/);
    malformed('rejects content-derived override',s=>s.content.candidates=[],/DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED/);
    malformed('rejects reordered headers',s=>s.content.head.reverse(),/DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED/);
    malformed('rejects changed grouping',s=>s.content.headTop[1].colspan=9,/DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED/);
    malformed('rejects changed title',s=>s.content.config.title='其他报表',/DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED/);
    for(const invalid of [true,-1,'-0.01','1.001','NaN','Infinity','1e2','1000000000000'])
      malformed(`rejects invalid amount ${String(invalid)}`,s=>s.content.data[0][1]=invalid,/DAILY_ELECTRONIC_AMOUNT_INVALID/);
    check('rejects company/store/date/scope/time abuse',()=>{
      for(const options of [{companyId:'00000000-0000-4000-8000-000000000001'},
        {storeId:'00000000-0000-4000-8000-000000000002'}, {day:'2025-12-31'}, {day:'2027-01-01'},
        {scope:'project_detail'}, {time:'infinity'}, {time:'2025-12-31T00:00:00Z'}, {time:'2100-01-01T00:00:00Z'}])
        rejects(`set role service_role;${call(source(),options)}`,/DAILY_ELECTRONIC_/);
      rejects(`set role service_role;select public.zysyr_ingest_daily_electronic_source('${company}','${xiangStore}',
        ((clock_timestamp() at time zone 'Asia/Shanghai')::date+1),'${projects}',now(),'{}');`,/DAILY_ELECTRONIC_DATE_INVALID/);
    });
    const free=ingest(source('2026-01-01',projects,'1009951'),{storeId:freeStore});
    check('reader is isolated, bounded and excludes raw snapshots from lists',()=>{
      const freeList=read({storeId:freeStore});assert.equal(freeList.items.length,1);assert.equal(freeList.items[0].candidate_id,free.candidate_id);
      assert.equal(freeList.formal_ledger_amount_changed,false);
      assert.equal(freeList.stage,'source_only');
      assert(read().items.every(item=>!('source_payload'in item)&&!('candidate_payload'in item)));
      assert.throws(()=>read({storeId:freeStore,id:first.candidate_id}),error=>/DAILY_ELECTRONIC_CANDIDATE_NOT_FOUND/.test(String(error.stderr)));
      assert.throws(()=>read({from:'2026-01-02',to:'2026-01-31',id:first.candidate_id}),error=>/DAILY_ELECTRONIC_CANDIDATE_NOT_FOUND/.test(String(error.stderr)));
      assert.throws(()=>read({scope:allBusiness,id:first.candidate_id}),error=>/DAILY_ELECTRONIC_CANDIDATE_NOT_FOUND/.test(String(error.stderr)));
      assert.throws(()=>read({from:'2026-01-01',to:'2026-02-01'}),error=>/DAILY_ELECTRONIC_READ_RANGE_INVALID/.test(String(error.stderr)));
    });
    check('immutable evidence/candidates/audit resist mutation even by owner',()=>{
      for(const table of ['snapshots','candidates','ingest_events']){
        rejects(`delete from public.zysyr_daily_electronic_${table};`,/DAILY_ELECTRONIC_EVIDENCE_IMMUTABLE/);
        rejects(`update public.zysyr_daily_electronic_${table} set created_at=now();`,/DAILY_ELECTRONIC_EVIDENCE_IMMUTABLE/);
      }
    });
    const raceSource=source('2026-01-06');
    const races=await Promise.all([1,2].map(()=>runSql(`set role service_role;${call(raceSource,{time:'2026-01-07T00:00:00Z'})}`)));
    check('concurrent duplicate writers serialize to one snapshot/candidate/audit',()=>{
      const receipts=races.map(out=>JSON.parse(out.trim().split('\n').at(-1)));
      assert.equal(receipts.filter(row=>row.inserted).length,1);assert.equal(receipts[0].snapshot_id,receipts[1].snapshot_id);
      assert.equal(sql(`select count(*) from public.zysyr_daily_electronic_ingest_events where snapshot_id='${receipts[0].snapshot_id}';`),'1');
    });
    const raceA=source('2026-01-07'),raceB=source('2026-01-07');raceB.content.data[0][1]='46';
    const raceResults=await Promise.allSettled([raceA,raceB].map(payload=>runSql(`set role service_role;${call(payload,{time:'2026-01-08T00:00:00Z'})}`)));
    check('concurrent different content at same timestamp yields one conflict',()=>{
      assert.equal(raceResults.filter(result=>result.status==='fulfilled').length,1);
      const failure=raceResults.find(result=>result.status==='rejected');assert.match(failure.reason.message,/DAILY_ELECTRONIC_SAME_TIME_CONFLICT/);
    });
    check('a verified later return to prior content reuses evidence and follows fetched_at, not version',()=>{
      const restored=ingest(source(),{time:'2026-01-02T00:30:00Z'});
      assert.equal(restored.version,1);assert.equal(restored.snapshot_id,first.snapshot_id);
      assert.equal(restored.latest,true);assert.equal(restored.inserted,false);assert.equal(restored.watermark_advanced,true);
      const current=read({scope:projects}).items.find(item=>item.business_date==='2026-01-01');
      assert.equal(current.snapshot_id,first.snapshot_id);assert.equal(Date.parse(current.latest_fetched_at),Date.parse('2026-01-02T00:30:00Z'));
      assert.equal(read({id:second.candidate_id}).items[0].latest,false);
    });
    check('failed transactions leave no orphan evidence/candidates and every head is internally consistent',()=>{
      assert.equal(sql(`select count(*) from public.zysyr_daily_electronic_snapshots s
        left join public.zysyr_daily_electronic_candidates c on c.snapshot_id=s.id where c.id is null;`),'0');
      assert.equal(sql(`select count(*) from public.zysyr_daily_electronic_heads h
        join public.zysyr_daily_electronic_candidates c on c.id=h.candidate_id
        join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
        where c.snapshot_id<>s.id or s.company_id<>h.company_id or s.store_id<>h.store_id
          or s.business_date<>h.business_date or s.source_scope<>h.source_scope;`),'0');
      assert.equal(sql(`select count(*) from public.zysyr_daily_electronic_snapshots
        where source_sha256<>encode(sha256(convert_to(source_payload::text,'UTF8')),'hex');`),'0');
    });
    check('all original 41 confirmed/manual/locked/financial rows are untouched',()=>{
      assert.equal(sql(`select jsonb_build_object('drafts',(select jsonb_agg(d order by id) from public.zysyr_daily_sheet_drafts d),
        'income',(select jsonb_agg(i) from public.zysyr_income_records i),'locks',(select jsonb_agg(l) from public.zysyr_period_locks l));`),legacyBefore);
    });
    console.log(`Daily electronic source DB: ${passed} checks passed; no production access; formal ledger unchanged.`);
  } finally {
    if(created){
      docker(['rm','-f','-v',container]);
      assert.equal(docker(['ps','-aq','--filter',`name=^/${container}$`]).trim(),'','only self-created container removed');
    }
  }
}
main().catch(error=>{console.error(String(error.stderr||error.stack||error));process.exitCode=1;});
