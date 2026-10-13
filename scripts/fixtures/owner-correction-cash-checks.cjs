// Existing isolated admin fixture only. No production connection or credentials.
const fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=function ({sql,json,fail,state,C,S,A,D,id,q,service}) {
 const migration=fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_zysyr_owner_correction_cash_review.sql'));
 assert(migration);
 sql(fs.readFileSync('supabase/migrations/20261010080343_zysyr_daily_cash_human_review.sql','utf8'));
 // Existing fixture omits upstream source tables. Keep all real correction/ledger
 // functions; only substitute the source context transport with deterministic hashes.
 sql(`create or replace function zysyr_private.lock_daily_cash_review(p_draft uuid,p_actor uuid default null) returns void language plpgsql as $$begin return;end$$;
 create or replace function zysyr_private.daily_cash_review_context(p_company uuid,p_store uuid,p_draft uuid) returns jsonb language sql as $$
 select jsonb_build_object('revision',d.edit_revision,'original_ready',coalesce(current_setting('test.original_missing',true),'')<>'yes',
 'source_hash',coalesce(nullif(current_setting('test.source_hash',true),''),repeat('a',64)),
 'cell_hash',(select encode(sha256(convert_to(jsonb_agg(jsonb_build_object('id',c.id,'value',zysyr_private.daily_sheet_cell_value(c),'label',c.row_label) order by c.id)::text,'UTF8')),'hex') from public.zysyr_daily_sheet_cells c where c.draft_id=d.id))
 from public.zysyr_daily_sheet_drafts d where d.id=p_draft and d.company_id=p_company and d.store_id=p_store $$;
 insert into zysyr_roles(id,code,name) values('${id(36)}','finance','Synthetic finance');
 insert into zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type) values('${C}','${id(33)}','${id(36)}','company');
 insert into zysyr_capabilities(id,code,name,risk_level) values('${id(37)}','daily_report.write','Synthetic finance writing','high');
 insert into zysyr_user_capability_grants(company_id,user_account_id,capability_id,scope_type) values('${C}','${id(33)}','${id(37)}','company');
 update zysyr_daily_sheet_drafts set ocr_raw_result=jsonb_set(ocr_raw_result,'{autofill,cash_receipts,cash_channels_complete}','false') where id='${D}';
 insert into zysyr_private.daily_cash_reviews(company_id,store_id,draft_id,edit_revision,reviewer_account_id,reviewer_auth_user_id,source_hash,cell_hash,request_id,reason)
 select '${C}','${S}','${D}',d.edit_revision,'${id(33)}','${id(34)}',c->>'source_hash',c->>'cell_hash','${id(90)}','Synthetic existing finance review'
 from zysyr_daily_sheet_drafts d cross join lateral zysyr_private.daily_cash_review_context('${C}','${S}','${D}') c where d.id='${D}';`);
 assert.equal(sql(service+`select zysyr_private.daily_cash_review_is_current('${C}','${S}','${D}');`).split('\n').at(-1),'t');
 const cell=sql(`select id from zysyr_daily_sheet_cells where draft_id='${D}' and cell_role='staff_value' limit 1;`);
 const revision=Number(sql(`select edit_revision from zysyr_daily_sheet_drafts where id='${D}';`));
 const consent={statement:'owner-confirmed-cash-review-v1',source_token:'a'.repeat(64),reviewed_original:true,reviewed_channels:true,reviewed_card_sales:true};
 const labelCells=[{id:cell,row_label:'Synthetic corrected label'}];
 const legacy=service+`select zysyr_correct_confirmed_daily_sheet('${A}','${C}','${S}','${D}',${revision},'${id(91)}','${JSON.stringify(labelCells)}','Synthetic label correction');`;
 const before=state();fail(legacy,/CONTROL_MISMATCH/);assert.equal(state(),before,'old route source-revision failure leaves ledger intact');
 const financialFunctions=sql("select string_agg(pg_get_functiondef(oid),E'\\n' order by proname) from pg_proc where pronamespace='zysyr_private'::regnamespace and proname in ('daily_sheet_validation','admin_correction_save_daily_sheet_cells','admin_correction_confirm_daily_sheet','daily_cash_reviewer_valid');");
 const tableAcl=sql("select string_agg(relname||':'||coalesce(relacl::text,''),E'\\n' order by relname) from pg_class where oid in ('zysyr_private.daily_cash_reviews'::regclass,'zysyr_daily_sheet_cells'::regclass,'zysyr_audit_events'::regclass);");
 sql(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 assert.equal(sql("select string_agg(pg_get_functiondef(oid),E'\\n' order by proname) from pg_proc where pronamespace='zysyr_private'::regnamespace and proname in ('daily_sheet_validation','admin_correction_save_daily_sheet_cells','admin_correction_confirm_daily_sheet','daily_cash_reviewer_valid');"),financialFunctions,'all monetary/ordinary finance functions byte-preserved');
 assert.equal(sql("select string_agg(relname||':'||coalesce(relacl::text,''),E'\\n' order by relname) from pg_class where oid in ('zysyr_private.daily_cash_reviews'::regclass,'zysyr_daily_sheet_cells'::regclass,'zysyr_audit_events'::regclass);"),tableAcl);
 const reviewed=(cells=labelCells,{actor=A,auth=id(30),store=S,rev=revision,request=id(92),confirmation=consent}={})=>service+`select zysyr_correct_confirmed_daily_sheet_with_cash_review('${actor}','${C}','${store}','${D}',${rev},'${request}',${q(JSON.stringify(cells))},'核对','${auth}',${q(JSON.stringify(confirmation))});`;
 for(const role of ['anon','authenticated'])fail('set role '+role+';'+reviewed(),/permission denied/);
 for(const opt of [{actor:id(31),auth:id(32)},{actor:id(33),auth:id(34)},{auth:id(99)},{store:id(22)},{rev:revision-1}]){fail(reviewed(labelCells,opt),/FORBIDDEN|NOT_FOUND|REVISION_CONFLICT/);assert.equal(state(),before);}
 for(const confirmation of [{...consent,reviewed_original:false},{...consent,reviewed_channels:false},{...consent,reviewed_card_sales:false},{...consent,source_token:'b'.repeat(64)}]){fail(reviewed(labelCells,{confirmation}),/CONSENT_REQUIRED|SOURCE_CHANGED/);assert.equal(state(),before);}
 fail("set test.original_missing='yes';"+reviewed(),/SOURCE_NOT_READY/);assert.equal(state(),before);
 fail("set test.locked='yes';"+reviewed(),/FINANCE_PERIOD_LOCKED/);assert.equal(state(),before);
 const badCells=[{id:cell,value:999}];const proofCount=sql('select count(*) from zysyr_private.daily_cash_reviews;');
 fail(reviewed(badCells),/CONTROL_MISMATCH/);assert.equal(state(),before);assert.equal(sql('select count(*) from zysyr_private.daily_cash_reviews;'),proofCount,'failed arithmetic rolls back new proof and audit');
 fail(reviewed(),/CASH_LEDGER_MISMATCH/);assert.equal(state(),before);assert.equal(sql('select count(*) from zysyr_private.daily_cash_reviews;'),proofCount,'unsupported legacy income combination rolls back the entire correction');
 // Supported cash-only case: prepare synthetic cells, never rewrite a real record.
 sql(`update zysyr_daily_sheet_cells set corrected_numeric=case when cell_role='payment_card_consumption' then 0 else 150 end
   where draft_id='${D}' and cell_role in ('payment_method','payment_cashflow','payment_total','payment_card_consumption');
 insert into zysyr_private.daily_cash_reviews(company_id,store_id,draft_id,edit_revision,reviewer_account_id,reviewer_auth_user_id,source_hash,cell_hash,request_id,reason)
 select '${C}','${S}','${D}',d.edit_revision,'${id(33)}','${id(34)}',c->>'source_hash',c->>'cell_hash','${id(93)}','Synthetic cash-only source review'
 from zysyr_daily_sheet_drafts d cross join lateral zysyr_private.daily_cash_review_context('${C}','${S}','${D}') c where d.id='${D}';`);
 const oldProofs=sql(`select count(*) from zysyr_private.daily_cash_reviews where edit_revision=${revision};`);
 const result=json(reviewed());assert.equal(result.corrected,true);assert.equal(result.cash_source_reviewed,true);assert.equal(result.edit_revision,revision+1);
 assert.equal(sql(service+`select zysyr_private.daily_cash_review_is_current('${C}','${S}','${D}');`).split('\n').at(-1),'t');
 assert.equal(sql(`select count(*) from zysyr_private.daily_cash_reviews where edit_revision=${revision};`),oldProofs,'old finance reviews retained');
 assert.equal(sql(`select count(*) from zysyr_private.daily_cash_reviews where edit_revision=${revision+1} and reviewer_account_id='${A}';`),'1','new proof names the actual owner');
 assert.equal(sql("select count(*) from zysyr_daily_reports where status='approved';"),'1');
 assert.equal(sql("select sum(amount) from zysyr_income_records where status='approved';"),'150.00','label-only correction preserves actual cash income');
 const after=state();assert.equal(json(reviewed()).already_applied,true);assert.equal(state(),after,'lost reply/idempotent repeat adds nothing');
 fail(reviewed(labelCells,{confirmation:{...consent,source_token:'b'.repeat(64)}}),/REQUEST_REUSED/);assert.equal(state(),after);
 fail(`delete from zysyr_private.daily_cash_reviews where id='${result.cash_review_id}';`,/append-only/);
 assert.equal(sql(`select zysyr_private.daily_cash_reviewer_valid('${A}','${id(30)}','${C}','${S}');`),'f','owner is never made ordinary finance');
 fail(`set role service_role;select zysyr_private.daily_correction_cash_review_is_current('${C}','${S}','${D}','{}');`,/permission denied/);
 const actualCell=sql(`select id from zysyr_daily_sheet_cells where draft_id='${D}' and cell_role='summary_actual' limit 1;`);
 fail(reviewed([{id:actualCell,value:null}],{rev:revision+1,request:id(94)}),/CONTROL_MISMATCH/);assert.equal(state(),after,'unknown actual amount remains blocked');
 const numericCells=json(`select jsonb_agg(jsonb_build_object('id',id,'value',case when cell_role='payment_card_consumption' or column_code='card_subtotal' then 0 else 200 end)) from zysyr_daily_sheet_cells where draft_id='${D}' and cell_role not in ('signature','note','unclosed_order');`);
 const changed=json(reviewed(numericCells,{rev:revision+1,request:id(94)}));assert.equal(changed.edit_revision,revision+2);
 assert.equal(sql("select sum(amount) from zysyr_income_records where status='approved';"),'200.00','explicit balanced cash correction changes only the new effective ledger');
 assert.equal(sql("select count(*) from zysyr_daily_reports where status='approved';"),'1');
 sql(`update zysyr_user_capability_grants set revoked_at=now(),revoked_by_user_id='${A}',revoke_reason='Synthetic owner revoke' where user_account_id='${A}';`);
 assert.equal(sql(service+`select zysyr_private.daily_cash_review_is_current('${C}','${S}','${D}');`).split('\n').at(-1),'f','revoked owner cannot keep a live correction authority');
 console.log('Owner cash correction PG: old failure reproduced; one explicit new-revision proof, exact roles/Auth/source/hash, unchanged arithmetic/ACL, rollback, ledger uniqueness, immutable history and idempotency passed.');
};
