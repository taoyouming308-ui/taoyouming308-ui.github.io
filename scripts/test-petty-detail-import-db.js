// Synthetic isolated PostgreSQL; no production connection.
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
const name='petty-detail-'+process.pid, id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=input=>execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);try{
for(let i=0;i<80;i++){try{sql('select 1');break;}catch{await new Promise(r=>setTimeout(r,250));}}
sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema zysyr_private;create schema storage;create table storage.buckets(id text,public boolean,allowed_mime_types text[]);insert into storage.buckets values('zysyr-reports',false,array['application/pdf']);
create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'scope denied'; end if;end$$;
create table public.zysyr_stores(company_id uuid,id uuid,unique(company_id,id));insert into public.zysyr_stores values('${id(1)}','${id(2)}');
create table public.zysyr_user_accounts(company_id uuid,id uuid,unique(company_id,id));insert into public.zysyr_user_accounts values('${id(1)}','${id(3)}');
create table public.zysyr_voucher_attachments(company_id uuid,store_id uuid,id uuid primary key,note text,audit_status text,unique(company_id,id));
create table public.zysyr_voucher_links(company_id uuid,store_id uuid,voucher_id uuid,unlinked_at timestamptz);
create function public.zysyr_review_voucher(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,uuid[],text) returns public.zysyr_voucher_attachments language plpgsql as $$declare v public.zysyr_voucher_attachments;begin update public.zysyr_voucher_attachments set audit_status=$5 where id=$4 returning * into v; return v;end$$;`);
sql(fs.readFileSync('supabase/migrations/20261114025943_petty_detail_import.sql','utf8'));
assert.equal(sql("select public::text||':'||array_to_string(allowed_mime_types,',') from storage.buckets"),'false:application/pdf,text/csv');
const row={transaction_date:'2026-07-01',amount:236.8,summary:'咖啡',source_row:2,row_key:'c'.repeat(64),raw:['2026-07-01','236.80','咖啡']};
const source={sha256:'a'.repeat(64),selection_hash:'a'.repeat(64),filename:'test.csv',object_path:'synthetic/private.csv'};
const quote=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const save=(actor=id(3),store=id(2),rows=[row],hash=source)=>`select public.zysyr_save_petty_detail_import('${actor}','${id(1)}','${store}','2026-07-01',${quote(hash)},'{}',${quote(rows)});`;
assert.throws(()=>sql(save(id(4))));assert.throws(()=>sql(save(id(3),id(4))));
assert.throws(()=>sql(save(id(3),id(2),[{...row,transaction_date:'2026-08-01'}])));assert.equal(sql('select count(*) from public.zysyr_petty_detail_imports'),'0');
let saved=JSON.parse(sql(save()));assert.equal(saved.inserted,1);assert.equal(saved.posted,false);assert(JSON.parse(sql(save())).duplicate);
assert.throws(()=>sql(save(id(3),id(2),[row],{...source,sha256:'b'.repeat(64),selection_hash:'b'.repeat(64)})));assert.equal(sql('select count(*) from public.zysyr_petty_detail_imports'),'1');
const draft=sql('select id from public.zysyr_petty_detail_drafts');
sql(`insert into public.zysyr_voucher_attachments values('${id(1)}','${id(2)}','${id(5)}','petty_cash_batch|2026-07|batch|test.jpg','pending');`);
const link=(month='2026-07-01',fields={document_date:'2026-07-01',amount:236.8})=>`select public.zysyr_link_petty_detail_draft('${id(3)}','${id(1)}','${id(2)}','${month}','${draft}','${id(5)}',${quote(fields)},'人工确认');`;
assert.throws(()=>sql(link('2026-08-01')));assert.throws(()=>sql(link('2026-07-01',{document_date:'2026-07-01'})));
assert.equal(sql('select audit_status from public.zysyr_voucher_attachments'),'pending');assert.equal(JSON.parse(sql(link())).posted,false);assert.throws(()=>sql(link()));
assert.equal(sql('select amount from public.zysyr_petty_detail_drafts'),'236.80');assert.equal(sql('select count(*) from public.zysyr_petty_detail_links'),'1');
assert.throws(()=>sql('set role authenticated;select * from public.zysyr_petty_detail_drafts;'));assert.throws(()=>sql('set role service_role;delete from public.zysyr_petty_detail_drafts;'));assert.throws(()=>sql('set role anon;'+save()));
assert.equal(sql("select count(*) from pg_class where relname like 'zysyr_petty_detail_%' and relkind='r' and relrowsecurity"),'3');
console.log('Petty detail DB: migration, permissions/RLS, draft-only atomic import, source/row duplicate protection, cross-store/month denial, human review/link and rollback passed.');
}finally{docker(['rm','-f',name]);}})().catch(e=>{console.error(e.stderr?.toString()||e);process.exitCode=1;});
