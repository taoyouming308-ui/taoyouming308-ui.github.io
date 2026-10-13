// Synthetic 542-cell / 402-physical-coordinate fixture, including duplicate B3.
// Runs only inside the existing network-isolated disposable PostgreSQL fixture.
const fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=function({sql,json,fail,state,C,S,A,D,id,q,service}) {
 const priorVersions=sql('select jsonb_agg(v order by version) from zysyr_daily_sheet_versions v;');
 const priorAudits=sql('select jsonb_agg(a order by id) from zysyr_audit_events a;');
 const priorProofs=sql('select jsonb_agg(r order by id) from zysyr_private.daily_cash_reviews r;');
 const insert=`insert into zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,column_code,column_label,row_number,column_number,cell_role,source_method,manual_override,corrected_numeric)`;
 sql(`${insert} values
 ('${C}','${S}','${D}','stylist','stylist_1','Synthetic','retail','Synthetic retail',3,4,'staff_value','blank_template',true,null),
 ('${C}','${S}','${D}','stylist','stylist_category_total','Synthetic','retail','Synthetic retail total',10,4,'category_total','blank_template',true,null);
 ${insert} select '${C}','${S}','${D}','product','synthetic_note_'||((n-1)/30),'Synthetic note','note_'||(1+(n-1)%30),'Synthetic note',50+(n-1)/30,1+(n-1)%30,'note','blank_template',true,null from generate_series(1,389) n;
 ${insert} values ('${C}','${S}','${D}','stylist','stylist_legacy_blank','Synthetic blank template','cut','Synthetic cut',3,2,'staff_value','blank_template',true,null);
 ${insert} select '${C}','${S}','${D}','product','synthetic_legacy_'||((n-1)/30),'Synthetic blank template','note_'||(1+(n-1)%30),'Synthetic note',50+(n-1)/30,1+(n-1)%30,'note','blank_template',true,null from generate_series(1,139) n;
 update zysyr_daily_sheet_cells set corrected_numeric=300 where draft_id='${D}' and cell_role in ('summary_actual','summary_grand','payment_method','payment_cashflow','payment_total');`);
 assert.equal(sql(`select count(*) from zysyr_daily_sheet_cells where draft_id='${D}';`),'542');
 assert.equal(sql(`select count(distinct (section_code,row_number,column_number)) from zysyr_daily_sheet_cells where draft_id='${D}';`),'402');
 assert.equal(sql(`select count(*) from zysyr_daily_sheet_cells where draft_id='${D}' and section_code='stylist' and row_number=3 and column_number=2;`),'2');
 const helper=fs.readFileSync('supabase/migrations/20261010111632_zysyr_daily_post_logical_cells.sql','utf8').split('-- Apply only')[0];sql(helper);
 assert.equal(sql(`select count(distinct (c.section_code,a.archive_address)) from zysyr_daily_sheet_cells c join zysyr_private.daily_sheet_archive_coordinates('${C}','${S}','${D}') a on a.cell_id=c.id where c.draft_id='${D}';`),'542');
 const rev=Number(sql(`select edit_revision from zysyr_daily_sheet_drafts where id='${D}';`));
 const cells=json(`select jsonb_agg(jsonb_build_object('id',id,'value',case when column_code='retail' then 100 else 300 end)) from zysyr_daily_sheet_cells where draft_id='${D}' and (column_code='retail' or cell_role='staff_total' or (section_code='stylist' and row_key='stylist_category_total' and column_code='subtotal'));`);
 const consent={statement:'owner-confirmed-cash-review-v1',source_token:'a'.repeat(64),reviewed_original:true,reviewed_channels:true,reviewed_card_sales:true};
 const call=(payload=cells,{actor=A,auth=id(30),store=S,revision=rev,request=id(110),confirmation=consent}={})=>service+`select zysyr_correct_confirmed_daily_sheet_with_cash_review('${actor}','${C}','${store}','${D}',${revision},'${request}',${q(JSON.stringify(payload))},'Synthetic retail correction','${auth}',${q(JSON.stringify(confirmation))});`;
 const completeState=()=>state()+sql(`select jsonb_build_object('proofs',(select jsonb_agg(r order by id) from zysyr_private.daily_cash_reviews r),'uploads',(select jsonb_agg(u order by id) from zysyr_report_uploads u),'archived_cells',(select jsonb_agg(c order by id) from zysyr_report_cells c),'batches',(select jsonb_agg(b order by id) from zysyr_import_batches b),'import_rows',(select jsonb_agg(r order by id) from zysyr_import_rows r),'lines',(select jsonb_agg(l order by id) from zysyr_daily_report_lines l),'workflow',(select jsonb_agg(w order by id) from zysyr_workflow_events w),'links',(select jsonb_agg(v order by id) from zysyr_voucher_links v));`);
 const before=completeState();fail('\\set VERBOSITY verbose\n'+call(),/23505[\s\S]*B3/);assert.equal(completeState(),before,'real-shaped duplicate B3 failure rolls back all proof/archive/ledger/audit writes');
 const oldDefinition=sql("select pg_get_functiondef('zysyr_private.admin_correction_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)'::regprocedure);");
 const financialLines=s=>s.slice(s.indexOf("'line_type', 'income'"),s.indexOf('select jsonb_agg',s.indexOf('v_batch :=')));
 const aclBefore=sql("select string_agg(oid::text||':'||coalesce(proacl::text,''),E'\\n' order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'zysyr_private'::regnamespace);");
 const unchangedBefore=sql("select string_agg(proname||':'||md5(prosrc),E'\\n' order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'zysyr_private'::regnamespace) and proname<>'admin_correction_confirm_daily_sheet';");
 const migration=fs.readFileSync('supabase/migrations/20261013123127_zysyr_correction_logical_archive.sql','utf8');sql(migration);sql(migration);
 const newDefinition=sql("select pg_get_functiondef('zysyr_private.admin_correction_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)'::regprocedure);");
 assert.equal(financialLines(newDefinition),financialLines(oldDefinition),'exact income generation and batch validation preserved');
 assert.equal(sql("select string_agg(oid::text||':'||coalesce(proacl::text,''),E'\\n' order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'zysyr_private'::regnamespace);"),aclBefore,'all function ACLs preserved');
 assert.equal(sql("select string_agg(proname||':'||md5(prosrc),E'\\n' order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'zysyr_private'::regnamespace) and proname<>'admin_correction_confirm_daily_sheet';"),unchangedBefore,'all other functions including v632 guards unchanged');
 assert.equal(completeState(),before,'definition migration leaves every existing record intact');
 for(const opt of [{actor:id(31),auth:id(32)},{actor:id(33),auth:id(34)},{auth:id(99)},{store:id(22)},{revision:rev-1},{confirmation:{...consent,source_token:'b'.repeat(64)}}]){fail(call(cells,opt),/FORBIDDEN|NOT_FOUND|REVISION_CONFLICT|SOURCE_CHANGED/);assert.equal(completeState(),before);}
 for(const role of ['anon','authenticated']){fail('set role '+role+';'+call(),/permission denied/);assert.equal(completeState(),before);}
 fail("set test.original_missing='yes';"+call(),/SOURCE_NOT_READY/);assert.equal(completeState(),before);
 fail("set test.locked='yes';"+call(),/FINANCE_PERIOD_LOCKED/);assert.equal(completeState(),before);
 const actual=sql(`select id from zysyr_daily_sheet_cells where draft_id='${D}' and cell_role='summary_actual';`);
 fail(call([...cells,{id:actual,value:null}]),/CONTROL_MISMATCH/);assert.equal(completeState(),before);
 fail(call([...cells,{id:actual,value:999}]),/CONTROL_MISMATCH/);assert.equal(completeState(),before);
 const result=json(call());assert.equal(result.corrected,true);assert.equal(result.edit_revision,rev+1);
 assert.equal(sql(`select sum(amount) from zysyr_income_records where status='approved';`),'300.00');
 assert.equal(sql(`select count(*) from zysyr_daily_reports where status='approved';`),'1');
 assert.equal(sql(`select count(*) from zysyr_report_cells where report_id='${result.source_report_id}';`),'542','every logical cell archived, none dropped or merged');
 assert.equal(sql(`select count(distinct (sheet_name,cell_address)) from zysyr_report_cells where report_id='${result.source_report_id}';`),'542');
 const archived=json(`select jsonb_build_object('matched',count(*),'incorrect',count(*) filter(where r.numeric_value is distinct from zysyr_private.daily_sheet_cell_value(c) or r.row_number<>a.archive_row or r.column_number<>a.archive_column))
 from zysyr_daily_sheet_cells c join zysyr_private.daily_sheet_archive_coordinates('${C}','${S}','${D}') a on a.cell_id=c.id
 join zysyr_report_cells r on r.report_id='${result.source_report_id}' and r.sheet_name='原图电子日报/'||c.section_code and r.cell_address=a.archive_address where c.draft_id='${D}';`);
 assert.deepEqual(archived,{matched:542,incorrect:0},'every logical value and coordinate has exactly its own archived projection');
 assert.equal(sql(`select count(distinct (section_code,row_number,column_number)) from zysyr_daily_sheet_cells where draft_id='${D}';`),'402','original physical coordinates are preserved');
 const lineage=json(`with atomic as (select c.*,zysyr_private.daily_sheet_cell_value(c) as effective_value,row_number() over(order by c.row_number,c.column_number,c.section_code,c.row_key) as line from zysyr_daily_sheet_cells c where c.draft_id='${D}' and c.cell_role='staff_value' and zysyr_private.daily_sheet_cell_value(c)>0)
 select jsonb_agg(jsonb_build_object('code',c.column_code,'value',c.effective_value,'archive_value',r.numeric_value,'line_value',l.amount,'metric',l.metric_code,'address_matches',r.cell_address=a.archive_address))
 from atomic c join zysyr_private.daily_sheet_archive_coordinates('${C}','${S}','${D}') a on a.cell_id=c.id
 join zysyr_import_rows i on i.row_number=c.line and i.import_batch_id=(select import_batch_id from zysyr_daily_sheet_versions where draft_id='${D}' order by version desc limit 1)
 join zysyr_report_cells r on r.id=i.source_report_cell_id and r.report_id='${result.source_report_id}' and r.sheet_name='原图电子日报/'||c.section_code
 join zysyr_daily_report_lines l on l.source_report_cell_id=r.id and l.daily_report_id='${result.daily_report_id}';`);
 assert.equal(lineage.length,2);for(const x of lineage){assert.equal(Number(x.value),Number(x.archive_value));assert.equal(Number(x.value),Number(x.line_value));assert.equal(x.address_matches,true);}
 assert.ok(lineage.some(x=>x.code==='retail'&&x.metric==='SERVICE_RETAIL'&&Number(x.value)===100),'retail100 linked exactly once to its own archived source');
 assert.equal(sql(`select jsonb_agg(v order by version) from zysyr_daily_sheet_versions v where version<=${rev};`).includes(priorVersions.slice(1,-1)),true,'old immutable version snapshots retained');
 assert.equal(sql('select jsonb_agg(a order by id) from zysyr_audit_events a;').includes(priorAudits.slice(1,-1)),true,'old audit retained');
 assert.equal(sql(`select jsonb_agg(r order by id) from zysyr_private.daily_cash_reviews r where edit_revision<=${rev};`),priorProofs,'old proofs retained');
 const after=completeState();assert.equal(json(call()).already_applied,true);assert.equal(completeState(),after,'duplicate request adds no proof/archive/income/history');
 fail(call(cells.map(c=>({...c,value:101}))),/REQUEST_REUSED/);assert.equal(completeState(),after);
 console.log('Correction logical archive PG: 542 logical/402 physical, duplicate B3 23505 reproduced; retail100 success, all542 retained, exact unique source lineage, old audit/proof/history, no monetary/ACL changes, denials/rollback/idempotency passed.');
};
