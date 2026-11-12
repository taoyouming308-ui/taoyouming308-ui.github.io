// Extension to test-history-reparse-db.cjs; uses its disposable no-network DB.
const fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async function({sql,json,fail,q,id,C,S,A,B,R,args,state,decisions,concurrent,hash}){
 sql(fs.readFileSync('supabase/migrations/20261112064136_zysyr_history_generation_finance.sql','utf8'));
 const finance=()=>json(`set role service_role;select public.zysyr_history_generation_finance_state(${args});`);
 let f=finance();
 const raw=f.rows;
 const prefix=(f,request)=>[A,C,S,B,f.active_generation.id].map(q).join(',')+','+f.active_generation.version+','+q(f.state_fingerprint)+','+q(request);
 const review=(f,request=id(201),digest=f.finance.issue_digest)=>`set role service_role;select public.zysyr_history_generation_review(${prefix(f,request)},${q(digest)},'Synthetic explicitly reviewed all included months and rows');`;
 const confirm=(f,request=id(202),accepted=true)=>`set role service_role;select public.zysyr_history_generation_confirm(${prefix(f,request)},${q(f.finance.review_fingerprint)},${accepted},'Synthetic financial acceptance');`;
 const post=(f,request=id(203),approved=true)=>`set role service_role;select public.zysyr_history_generation_post(${prefix(f,request)},${q(f.finance.review_fingerprint)},${q(f.finance.confirmation_id)},${approved},'Synthetic formal posting approval');`;
 for(const table of ['history_generation_finance_actions','history_generation_post_context'])fail(`set role service_role;select * from zysyr_private.${table};`,/permission denied/);
 fail('set role anon;'+review(f).replace('set role service_role;',''),/permission denied/);
 fail(review(f,id(201),'wrong'),/ISSUES_NOT_ACKNOWLEDGED/);
 fail(confirm(f),/REVIEW_REQUIRED/);
 fail(`begin;update zysyr_user_role_grants set revoked_at=now(),revoke_reason='Synthetic revoke';`+review(f),/FINANCE_SCOPE_FORBIDDEN/);
 fail(`begin;delete from zysyr_role_capabilities;`+review(f),/FINANCE_SCOPE_FORBIDDEN/);
 fail(`begin;update zysyr_user_accounts set status='disabled';`+review(f),/FINANCE_SCOPE_FORBIDDEN/);
 assert.equal(f.finance.issue_material.reason,'Synthetic');assert.equal(f.finance.included_count,2);
 const reviewed=json(review(f));assert.equal(reviewed.effective_count,2);assert.equal(reviewed.formal_ledger_written,false);
 assert.deepEqual(json(review(f)),reviewed);fail(review(f,id(201),'different'),/REQUEST_REUSED/);
 const stale=f;f=finance();assert.notEqual(f.state_fingerprint,stale.state_fingerprint);assert.equal(f.finance.reviewed_count,2);
 fail(confirm(stale),/STATE_CHANGED/);fail(confirm(f,id(202),false),/ACCEPTANCE_REQUIRED/);
 // A reviewed generation cannot be silently superseded by reparse.
 const source=state();
 fail(`set role service_role;select public.zysyr_history_reparse_apply(${args},${q(id(210))},${q(source.state_fingerprint)},${q(source.source_sha256)},${q('c'.repeat(64))},${q(source.active_generation.proposal_digest)},'Synthetic supersede',${q(JSON.stringify(decisions))}::jsonb);`,/FINANCE_ALREADY_STARTED/);
 const confirmed=json(confirm(f));assert.equal(confirmed.financial_acceptance_performed,true);assert.equal(confirmed.formal_ledger_written,false);
 assert.deepEqual(json(confirm(f)),confirmed);f=finance();assert.equal(f.finance.confirmation_id,confirmed.action_id);
 fail(post(f,id(203),false),/CONFIRMATION_REQUIRED/);
 fail(`begin;insert into zysyr_period_locks(company_id,scope_type,store_id,period_month) values('${C}','store','${S}','2026-09-01');`+post(f),/FINANCE_PERIOD_LOCKED/);
 // After first real ledger insert, force a revision error: all entries, context,
 // batch status and finance audit must roll back together.
 sql("create function public.synthetic_post_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_POST_ROLLBACK';end$$;create trigger synthetic_post_failure before insert on zysyr_history_ledger_revisions for each row execute function public.synthetic_post_failure();");
 fail(post(f),/SYNTHETIC_POST_ROLLBACK/);assert.equal(sql('select count(*) from zysyr_history_ledger_entries'),'0');assert.equal(sql('select count(*) from zysyr_private.history_generation_post_context'),'0');assert.deepEqual(finance(),f);
 sql('drop trigger synthetic_post_failure on zysyr_history_ledger_revisions;drop function public.synthetic_post_failure();');
 const posted=json(post(f));assert.equal(posted.posted_count,2);assert.equal(posted.formal_ledger_written,true);assert.deepEqual(json(post(f)),posted);
 f=finance();assert.equal(f.finance.effective_status,'posted');assert.equal(f.finance.posted_count,2);assert.deepEqual(f.rows,raw);
 assert.equal(sql(`select raw_row_count||':'||imported_row_count||':'||status from zysyr_history_import_batches where id='${B}'`),'3:2:completed');
 assert.equal(sql(`select count(*) from zysyr_history_ledger_entries where import_row_id='${id(8)}'`),'0');
 assert.equal(sql('select count(*) from zysyr_history_ledger_revisions'),'2');
 assert.equal(sql("select posted_validation_status||':'||jsonb_array_length(posted_validation_issues) from zysyr_history_ledger_entries where source_locator='Sheet1!B1'"),'warning:1');
 assert.equal(sql('select count(*) from zysyr_private.history_generation_post_context'),'0');
 const status=json(`set role service_role;select public.zysyr_history_generation_finance_status(${args},${q(id(203))});`);assert.deepEqual(status.receipt,posted);assert.equal(status.request_binding.action,'post');
 fail('update zysyr_private.history_generation_finance_actions set reason=reason;',/IMMUTABLE|append/i);
 fail(`set role service_role;insert into zysyr_private.history_generation_post_context values(1,'${B}','${f.active_generation.id}','${A}','${confirmed.action_id}',2);`,/permission denied/);
 fail(`set role service_role;select public.zysyr_post_history_import_batch(${args},true,'synthetic');`,/VERSION_REQUIRED/);
 // Production-shaped count, entirely synthetic: retain all 865 rows,
 // exclude exactly 50 merged slaves, post only 815 included snapshots.
 const B3=id(300),scope3=[A,C,S,B3].map(q).join(',');
 sql(`insert into zysyr_history_import_batches select (jsonb_populate_record(null::zysyr_history_import_batches,to_jsonb(b)||jsonb_build_object('id','${B3}','source_sha256',repeat('9',64),'raw_row_count',865,'valid_row_count',865,'status','needs_review','imported_row_count',0,'confirmed_by_user_id',null,'confirmed_at',null,'confirmation_reason',null,'completed_at',null))).* from zysyr_history_import_batches b where id='${B}';
 insert into zysyr_history_import_rows(id,company_id,store_id,import_batch_id,source_sheet,source_row_number,source_locator,row_hash,raw_json,mapped_json,validation_status)
 select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'${C}','${S}','${B3}','Synthetic865',n,'Synthetic865!A'||n,repeat('8',64),'{}',jsonb_build_object('period_month','2026-09-01','cell_address','A'||n,'amount',1,'formula',null),'valid' from generate_series(1,865)n;`);
 const source3=()=>json(`set role service_role;select public.zysyr_history_reparse_state(${scope3});`);
 const state3=()=>json(`set role service_role;select public.zysyr_history_generation_finance_state(${scope3});`);
 const initial3=source3();
 const decisions3=initial3.rows.map((r,i)=>({import_row_id:r.id,source_locator:r.source_locator,source_row_hash:r.row_hash,original_raw:r.raw_json,original_mapped:r.mapped_json,
 source_snapshot:{cell_address:r.mapped_json.cell_address,cached_value:null,cache_present:false,formula:null,merged_master:i>=815?'A1':null,shared_formula_reference:null},
 disposition:i>=815?'exclude_merged_slave':'include',effective_mapped:r.mapped_json,validation_status:'valid',validation_issues:[],reason:i>=815?'merged_slave':'unchanged'}));
 const reparse3=(d,source,request)=>`set role service_role;select public.zysyr_history_reparse_apply(${scope3},${q(request)},${q(source.state_fingerprint)},${q('9'.repeat(64))},${q('c'.repeat(64))},${q(hash(d))},'Synthetic scale repair',${q(JSON.stringify(d))}::jsonb);`;
 const invalid3=structuredClone(decisions3);invalid3[0].validation_status='invalid';invalid3[0].validation_issues=['Synthetic invalid accounting field'];
 json(reparse3(invalid3,initial3,id(301)));
 const prefix3=(v,request)=>[A,C,S,B3,v.active_generation.id].map(q).join(',')+','+v.active_generation.version+','+q(v.state_fingerprint)+','+q(request);
 let v=state3();
 fail(`set role service_role;select public.zysyr_history_generation_review(${prefix3(v,id(302))},${q(v.finance.issue_digest)},'Cannot approve invalid rows');`,/INVALID_INCLUDED_ROW/);
 assert.equal(sql(`select count(*) from zysyr_private.history_generation_finance_actions where batch_id='${B3}'`),'0');
 json(reparse3(decisions3,source3(),id(303)));v=state3();
 json(`set role service_role;select public.zysyr_history_generation_review(${prefix3(v,id(304))},${q(v.finance.issue_digest)},'Synthetic review all 815 included rows');`);v=state3();
 json(`set role service_role;select public.zysyr_history_generation_confirm(${prefix3(v,id(305))},${q(v.finance.review_fingerprint)},true,'Synthetic separate financial acceptance');`);v=state3();
 const post3=`set role service_role;select public.zysyr_history_generation_post(${prefix3(v,id(306))},${q(v.finance.review_fingerprint)},${q(v.finance.confirmation_id)},true,'Synthetic separate 815 entry posting');`;
 const posts=await Promise.all([concurrent(post3),concurrent(post3)]);for(const result of posts)assert.equal(result.code,0,result.err);
 assert.deepEqual(JSON.parse(posts[0].out.split('\n').find(x=>x.startsWith('{'))),JSON.parse(posts[1].out.split('\n').find(x=>x.startsWith('{'))));
 assert.equal(sql(`select count(*) from zysyr_history_import_rows where import_batch_id='${B3}'`),'865');
 assert.equal(sql(`select count(*) from zysyr_history_ledger_entries where import_batch_id='${B3}'`),'815');
 assert.equal(sql(`select count(*) from zysyr_history_ledger_revisions where import_batch_id='${B3}'`),'815');
 assert.equal(sql(`select raw_row_count||':'||imported_row_count from zysyr_history_import_batches where id='${B3}'`),'865:815');
 assert.deepEqual(state3().rows,initial3.rows);assert.equal(sql('select count(*) from zysyr_private.history_generation_post_context'),'0');
 // Reverse ordering with the real legacy poster on an independent batch.
 const B4=id(401),R4=id(402),scope4=[A,C,S,B4].map(q).join(',');
 sql(`insert into zysyr_history_import_batches select (jsonb_populate_record(null::zysyr_history_import_batches,to_jsonb(b)||jsonb_build_object('id','${B4}','source_sha256',repeat('6',64),'raw_row_count',1,'valid_row_count',1,'status','needs_review','imported_row_count',0,'confirmed_by_user_id',null,'confirmed_at',null,'confirmation_reason',null,'completed_at',null))).* from zysyr_history_import_batches b where id='${B}';
 insert into zysyr_history_import_rows(id,company_id,store_id,import_batch_id,source_sheet,source_row_number,source_locator,row_hash,raw_json,mapped_json,validation_status)
 values('${R4}','${C}','${S}','${B4}','SyntheticPostFirst',1,'SyntheticPostFirst!A1',repeat('7',64),'{}','{"cell_address":"A1","amount":1,"formula":null,"period_month":"2026-09-01"}','valid');`);
 sql(`set role service_role;select public.zysyr_review_history_import_row(${[A,C,S,R4].map(q).join(',')},'{"cell_address":"A1","amount":1,"formula":null,"period_month":"2026-09-01"}','confirmed','Synthetic prior human review');`);
 const beforePost=json(`set role service_role;select public.zysyr_history_reparse_state(${scope4});`),r4=beforePost.rows[0];
 const d4=[{import_row_id:R4,source_locator:r4.source_locator,source_row_hash:r4.row_hash,original_raw:r4.raw_json,original_mapped:r4.mapped_json,
 source_snapshot:{cell_address:'A1',cached_value:null,cache_present:false,formula:null,merged_master:null,shared_formula_reference:null},disposition:'include',effective_mapped:r4.mapped_json,validation_status:'valid',validation_issues:[],reason:'unchanged'}];
 const legacyPosting=concurrent(`begin;set role service_role;select public.zysyr_post_history_import_batch(${scope4},false,'Synthetic reviewed legacy posting');select pg_sleep(0.7);commit;`);
 await new Promise(r=>setTimeout(r,200));
 const reparseAfterPost=concurrent(`set role service_role;select public.zysyr_history_reparse_apply(${scope4},${q(id(403))},${q(beforePost.state_fingerprint)},${q('6'.repeat(64))},${q('c'.repeat(64))},${q(hash(d4))},'Synthetic stale reparse',${q(JSON.stringify(d4))}::jsonb);`);
 const legacyPosted=await legacyPosting;assert.equal(legacyPosted.code,0,legacyPosted.err);
 const parseRejected=await reparseAfterPost;assert.notEqual(parseRejected.code,0);assert.match(parseRejected.err,/STATE_CHANGED|NOT_PRISTINE|PRIOR_ACTIVITY/);
 assert.equal(sql(`select count(*) from zysyr_history_ledger_entries where import_batch_id='${B4}'`),'1');
 assert.equal(sql(`select count(*) from zysyr_history_ledger_revisions where import_batch_id='${B4}'`),'1');
 assert.equal(sql(`select import_status from zysyr_history_import_rows where id='${R4}'`),'imported');
 assert.equal(sql(`select count(*) from zysyr_private.history_parse_generations where batch_id='${B4}'`),'0');
 console.log('PASS: legacy post-first/reparse-second preserves committed ledger and audit; 865 original/815 included/50 exclusions; 815 immutable posting revisions; invalid included rows reject despite exact acknowledgement; concurrent posting replay produces one receipt; real finance RBAC grants/revocations; version-bound review/confirm/post; exact issue acknowledgement and warnings retained; no implicit posting; period lock; rollback after ledger insert; replay/status; 3 original rows to 2 ledger/revision rows; no excluded ledger; private context inaccessible and cleaned.');
};
