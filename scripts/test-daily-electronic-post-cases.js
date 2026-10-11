// Only the existing disposable synthetic PostgreSQL fixture calls this module.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
module.exports=async function({sql,json,q,C,S,A,U,id}){
 const D=id(200),Q=id(201),snapshot=id(202),service="set request.jwt.claim.role='service_role';";
 const extract=(file,start,end)=>{const s=fs.readFileSync(file,'utf8'),i=s.indexOf(start);assert(i>=0);return s.slice(i,s.indexOf(end,i));};
 const attachment='supabase/migrations/20260828030414_zysyr_daily_calendar_editor_and_attachments.sql';
 sql(extract(attachment,'create table public.zysyr_daily_sheet_attachments','create index'));
 sql(extract('supabase/migrations/20260820102856_zysyr_sprint2_voucher_center.sql','create table public.zysyr_voucher_reviews','create index zysyr_voucher_reviews_store_idx'));
 sql(extract(attachment,'create or replace function public.zysyr_register_daily_sheet_attachment','revoke execute on function public.zysyr_register_daily_sheet_attachment'));
 sql(`alter table zysyr_daily_sheet_drafts alter column source_voucher_id drop not null;
 alter table zysyr_daily_electronic_heads add column company_id uuid default '${C}';
 alter table mgj_business_detail_snapshots add column shop_name text,add column business_date date,add column payload jsonb,add column source_count integer;
 insert into zysyr_capabilities(id,code,name) values('${id(203)}','voucher.review','Synthetic review');
 insert into zysyr_role_capabilities(role_id,capability_id) values('${id(35)}','${id(203)}');
 insert into zysyr_daily_sheet_drafts select (jsonb_populate_record(null::zysyr_daily_sheet_drafts,to_jsonb(d)||jsonb_build_object(
 'id','${D}','report_date','2026-10-08','status','draft','edit_revision',0,'source_voucher_id',null,'confirmed_at',null,'confirmed_by_user_id',null,'confirm_reason',null,
 'template_code','zysyr_frontdesk_project_draft','ocr_raw_result',jsonb_set(d.ocr_raw_result,'{autofill,snapshot_id}',to_jsonb('${snapshot}'::text))))).* from zysyr_daily_sheet_drafts d limit 1;
 insert into zysyr_daily_sheet_cells select (jsonb_populate_record(null::zysyr_daily_sheet_cells,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'draft_id','${D}'))).* from zysyr_daily_sheet_cells c where draft_id='${id(4)}';
 insert into mgj_business_detail_snapshots(id,source_sha256,shop_name,business_date,payload,source_count)
 values('${snapshot}',repeat('e',64),'Synthetic store','2026-10-08','{"bills":[{"source_bill_id":"synthetic-second","source_posted_amount_cents":10000}]}',1);
 insert into mgj_business_detail_heads values('Synthetic store','2026-10-08','${snapshot}',now());
 insert into mgj_daily_consumption values('Synthetic store','2026-10-08','[{"source_id":"synthetic-second","amount":100}]',now());`);
 const migration=fs.readFileSync('supabase/migrations/20261011043138_zysyr_electronic_daily_post.sql','utf8');sql(migration);sql(migration);
 const evidence=()=>json(service+`select public.zysyr_daily_electronic_post_context('${C}','${S}','${D}');`);
 assert.equal(evidence().ready,true);
 const makeReport=()=>({original_filename:'电子来源核对归档-2026-10-08.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes:100,sha256:'f'.repeat(64),bucket_id:'zysyr-reports',object_path:`${C}/${S}/daily/2026-10-08/electronic-${D}-${Q}.xlsx`,display_data:{electronic_source:evidence().evidence}});
 const post=(p={})=>{const e=evidence();return service+`select public.zysyr_confirm_daily_electronic_sheet('${p.actor||A}','${p.auth||U}','${C}','${p.store||S}','${D}',${p.revision??0},${q(p.token||e.source_token)},${q(p.cell||e.cell_hash)},'${Q}',${q(p.statement||'electronic-channels-sales-v1')},${q(JSON.stringify(p.report||makeReport()))}::jsonb,'Synthetic electronic final review');`;};
 const fail=(s,re)=>assert.throws(()=>sql(s),e=>re.test(String(e.stderr||e)));
 const unchanged=()=>sql(`select jsonb_build_object('drafts',(select jsonb_agg(to_jsonb(d) order by id) from zysyr_daily_sheet_drafts d),
 'cells',(select jsonb_agg(to_jsonb(c) order by id) from zysyr_daily_sheet_cells c),'income',(select count(*) from zysyr_income_records),
 'vouchers',(select count(*) from zysyr_voucher_attachments),'proofs',(select count(*) from zysyr_private.daily_cash_reviews));`),before=unchanged();
 for(const role of ['anon','authenticated'])fail('set role '+role+';'+post(),/permission denied/);
 for(const patch of [{auth:id(999)},{store:id(999)},{revision:9},{token:'wrong'},{cell:'wrong'},{statement:'automatic'},{report:{}}])
  fail(post(patch),/FORBIDDEN|DRAFT_NOT_FOUND|REVISION_CONFLICT|SOURCE_OR_CELLS_CHANGED|EXPLICIT_CONFIRMATION_REQUIRED|ARCHIVE_CONTEXT_INVALID/);
 for(const mutation of [
  `update mgj_daily_consumption set services='[]' where business_date='2026-10-08'`,
  `update mgj_business_detail_heads set snapshot_id='${id(999)}' where business_date='2026-10-08'`,
  `update zysyr_daily_sheet_cells set corrected_numeric=99 where draft_id='${D}' and cell_role='payment_total'`,
  `update zysyr_user_role_grants set revoked_at=now(),revoke_reason='Synthetic revoke'`, `set test.locked='yes'`
 ])fail('begin;'+mutation+';'+post(),/SOURCE_NOT_READY|SOURCE_OR_CELLS_CHANGED|FORBIDDEN|PERIOD_LOCKED/);
 // Fresh tokens never excuse a numerical difference or unknown receipt.
 for(const [code,value,restore] of [['total','99','100'],['card_subtotal','null','0']]){
  sql(`update zysyr_daily_sheet_cells set corrected_numeric=${value} where draft_id='${D}' and column_code='${code}'`);
  fail(post(),/VALUES_INCOMPLETE/);
  sql(`update zysyr_daily_sheet_cells set corrected_numeric=${restore} where draft_id='${D}' and column_code='${code}'`);
 }
 sql("create function public.electronic_fail_income() returns trigger language plpgsql as $$begin raise exception 'synthetic downstream';end$$;create trigger electronic_fail before insert on zysyr_income_records for each row execute function public.electronic_fail_income();");
 fail(post(),/synthetic downstream/);
 sql('drop trigger electronic_fail on zysyr_income_records;drop function public.electronic_fail_income();');
 assert.equal(unchanged(),before,'all rejected posting writes roll back');
 const edge=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8'),uploads=[];
 const read=()=>json(service+`select jsonb_build_object('draft',(select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='${D}'),'cells',(select jsonb_agg(to_jsonb(c) order by id) from zysyr_daily_sheet_cells c where draft_id='${D}'));`);
 // ExcelJS uses instanceof Array internally: normalize VM arrays into its realm.
 class Workbook extends require('exceljs').Workbook { addWorksheet(...args){const sheet=super.addWorksheet(...args),add=sheet.addRow.bind(sheet);
  sheet.addRow=row=>add(Array.from(row));sheet.addRows=rows=>Array.from(rows,row=>sheet.addRow(row));return sheet;} }
 const context={console,ExcelJS:{Workbook},crypto:require('node:crypto').webcrypto,MAX_REPORT_BYTES:10485760,
  SUPABASE_URL:'http://synthetic-storage',SERVICE_KEY:'synthetic',REPORT_BUCKET:'zysyr-reports',VOUCHER_BUCKET:'zysyr-vouchers',
  cleanText:(v,n)=>String(v??'').slice(0,n),uuidValue:v=>v,storagePath:x=>x,exactArrayBuffer:b=>b.buffer,
  sha256Bytes:async b=>require('node:crypto').createHash('sha256').update(b).digest('hex'),
  effectiveCellValue:c=>c.manual_override?c.corrected_numeric:c.ocr_numeric,restRowsAll:async()=>read().cells,
  fetch:async(url,options)=>{uploads.push({url,bytes:new Uint8Array(options.body)});return {ok:true};},
  financeRpcSaved:async(name,p)=>{
   if(name==='rpc/zysyr_daily_electronic_post_context')return evidence();
   assert.equal(name,'rpc/zysyr_confirm_daily_electronic_sheet');
   return json(service+`select public.zysyr_confirm_daily_electronic_sheet('${p.p_actor_user_id}','${p.p_actor_auth_user_id}','${C}','${S}','${D}',${p.p_expected_revision},${q(p.p_source_token)},${q(p.p_cell_hash)},'${p.p_request_id}',${q(p.p_statement)},${q(JSON.stringify(p.p_report))}::jsonb,${q(p.p_reason)});`);
  }};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(edge.slice(edge.indexOf('async function confirmElectronicDailySheet('),edge.indexOf('\nasync function importCenter('))),context);
 const cellsBefore=JSON.stringify(read().cells),prior=sql(`select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='${id(4)}'`);
 const result=await context.confirmElectronicDailySheet(C,S,D,A,{auth_user_id:U},read().draft,
  {statement:'electronic-channels-sales-v1',source_token:evidence().source_token,request_id:Q},0,'Synthetic explicit electronic review');
 assert.equal(result.confirmed,true);assert.equal(uploads.length,2);
 const workbook=new (require('exceljs').Workbook)();await workbook.xlsx.load(uploads[0].bytes);
 assert.match(workbook.worksheets[0].getCell('B1').value,/非纸质/);
 assert.equal(JSON.stringify(read().cells),cellsBefore,'posting never changes entered amounts');
 assert.equal(sql(`select to_jsonb(d) from zysyr_daily_sheet_drafts d where id='${id(4)}'`),prior,'previous confirmed report untouched');
 assert.equal(read().draft.status,'confirmed');
 assert.equal(sql(`select count(*) from zysyr_audit_events where entity_id='${D}' and action='review_electronic_source'`),'1');
 fail(post(),/ALREADY_CONFIRMED/);
 console.log('Electronic posting: real XLSX/Edge/PG pipeline, unchanged amounts/history, missing/stale source, scope, revision/hash, consent, rollback and duplicate rejection passed.');
};
