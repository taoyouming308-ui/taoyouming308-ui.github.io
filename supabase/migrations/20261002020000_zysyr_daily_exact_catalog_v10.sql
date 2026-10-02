-- Independent local candidate: 8 exact catalog tuples; install does not recalculate history.
set statement_timeout='30s';
set lock_timeout='5s';
create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 when p_shop in('1837032','1009951') and p_name ~ '^歌薇酸护(（盖白发）)?([0-9]+(元)?)?$' then 'treatment'
 else (select category from(values
 ('1837032','101','洗吹98元','makeup_styling'),
 ('1837032','103','洗发15分钟','wash_cut_blow'),
 ('1837032','104','洗发15分钟内','wash_cut_blow'),
 ('1837032','201','剪发120','wash_cut_blow'),
 ('1837032','202','剪发180','wash_cut_blow'),
 ('1837032','203','剪发280','wash_cut_blow'),
 ('1837032','205','剪发79','wash_cut_blow'),
 ('1837032','311','烫刘海400','perm'),
 ('1837032','323','质感烫发699','perm'),
 ('1837032','324','健康烫发980','perm'),
 ('1837032','427','褪色','color'),
 ('1837032','439','健康染699','color'),
 ('1009951','101','洗吹98元','makeup_styling'),
 ('1009951','103','洗发15分钟','wash_cut_blow'),
 ('1009951','104','洗发15分钟内','wash_cut_blow'),
 ('1009951','201','剪发120','wash_cut_blow'),
 ('1009951','202','剪发180','wash_cut_blow'),
 ('1009951','203','剪发280','wash_cut_blow'),
 ('1009951','204','剪发380','wash_cut_blow'),
 ('1009951','308','烫发1780','perm'),
 ('1009951','316','烫发980','perm'),
 ('1009951','417','基础染中发','color'),
 ('1009951','434','基础染长发1060','color'),
 ('1009951','501','护理400','treatment'),
 ('1009951','512','歌薇酸护680','treatment'),
 ('1837032','511','歌薇酸护480','treatment'),
 ('1009951','307','烫发1380','perm'),
 ('1009951','410','健康染中发','color'),
 ('1009951','411','健康染长发','color'),
 ('1009951','416','基础染短发','color'),
 ('1009951','523','歌薇酸护（盖白发）880','treatment'),
 ('1009951','513','歌薇酸护880','treatment'),
 ('1837032','314','健康烫发1380元','perm'),
 ('1837032','417','基础染中发','color'),
 ('1837032','442','健康染发880','color'),
 ('1837032','431','漂发1200','color'),
 ('1009951','409','健康染短发','color'),
 ('1009951','428','健康染长发1460','color'),
 ('1009951','436','健康染长发14603次','color')
 ,
 ('1009951','312','头颅增高烫','perm'),
 ('1009951','310','造型烫2580','perm'),
 ('1009951','311','烫刘海400','perm'),
 ('1009951','430','漂发800','color'),
 ('1009951','431','漂发1200','color'),
 ('1009951','406','漂发400','color'),
 ('1009951','518','Olaplex长发','treatment'),
 ('1837032','307','烫发1380','perm')
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;
alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6','frontdesk-autofill-v7','frontdesk-autofill-v8','frontdesk-autofill-v9','frontdesk-autofill-v10'));
create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 earned_card numeric; source jsonb; cash_projection jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
 conflicts jsonb; before_data jsonb; after_data jsonb; cell jsonb; result jsonb; n integer:=0; is_new boolean:=false;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'AUTOFILL_SERVICE_REQUIRED'; end if;
 store:=case p_shop when '自由手艺人' then 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid
   when '向里造型' then '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid end;
 if store is null or p_day is null or p_day<date '2026-01-01' or p_day>date '2026-12-31'
  or p_day>(now() at time zone 'Asia/Shanghai')::date then raise exception 'AUTOFILL_SCOPE_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('daily_autofill:'||store||':'||p_day,0));
 if zysyr_private.period_is_locked(company,store,p_day) then return jsonb_build_object('status','period_locked','automatic_posting_enabled',false); end if;
 if exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
   and d.report_date=p_day and d.status='confirmed') then return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false); end if;
 source:=public.mgj_read_business_details(p_shop,p_day);
 if source->'available' is distinct from 'true'::jsonb or source->'source_list_changed' is distinct from 'false'::jsonb
 then return jsonb_build_object('status','source_unavailable_or_changed','automatic_posting_enabled',false); end if;
 sid:=(source->>'snapshot_id')::uuid;
 cash_projection:=zysyr_daily_electronic_private.cash_receipt_projection(company,store,p_day);
 if (select count(*) from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft')>1 then return jsonb_build_object('status','multiple_drafts_preserved','automatic_posting_enabled',false); end if;
 select * into draft from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft' for update;
 -- Recheck after waiting on an existing row lock: finance may have confirmed it.
 if exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
   and d.report_date=p_day and d.status='confirmed') then return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false); end if;
 -- Never convert a human-populated legacy grid into source rows silently.
 if draft.id is not null and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then
  return jsonb_build_object('status','manual_draft_preserved','draft_id',draft.id,'needs_finance_review',true,'automatic_posting_enabled',false);
 end if;
 -- Source-head triggers cannot silently upgrade an existing old mapping.
 if pg_trigger_depth()>0 and draft.id is not null
  and (select e.mapping_version from public.zysyr_daily_autofill_events e
       where e.draft_id=draft.id order by e.revision desc limit 1) is distinct from 'frontdesk-autofill-v10'
 then return jsonb_build_object('status','mapping_upgrade_requires_review','draft_id',draft.id,
  'automatic_posting_enabled',false,'formal_ledger_amount_changed',false); end if;
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v10'
  and draft.ocr_raw_result#>'{autofill,cash_receipts}' is not distinct from cash_projection->'metadata'
 then return jsonb_build_object('status','already_applied','draft_id',draft.id,'automatic_posting_enabled',false); end if;
 cells:=zysyr_daily_electronic_private.autofill_cells(source);
 -- One writer, one immutable before/after event. Replacement by exact cell key
 -- avoids two projections double-counting project payment channels.
 if cash_projection->'available'='true'::jsonb then
  select coalesce(jsonb_agg(x),'[]'::jsonb) into cells from jsonb_array_elements(cells)x
   where not exists(select 1 from jsonb_array_elements(cash_projection->'cells')c
    where c->>'section_code'=x->>'section_code' and c->>'row_key'=x->>'row_key' and c->>'column_code'=x->>'column_code');
  cells:=cells||(cash_projection->'cells');
 end if;
 -- Daily performance totals include EARNED stylist card performance, not raw cardfee.
 -- External receipts / cash_flow remain unchanged for the monthly income path.
 earned_card:=zysyr_daily_electronic_private.earned_card_total(source);
 select coalesce(jsonb_agg(case when x->>'section_code'='summary' and x->>'column_code' in('actual_total','grand_total')
   or x->>'section_code'='payment' and x->>'column_code'='total'
  then jsonb_set(x,'{value}',coalesce(to_jsonb((x->>'value')::numeric+earned_card),'null'::jsonb)) else x end),'[]'::jsonb)
 into cells from jsonb_array_elements(cells)x;
 cells:=cells||jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment','row_label','支付',
  'column_code','card_consumption','column_label','卡金消费','row_number',33,'column_number',11,
  'cell_role','payment_card_consumption','value',earned_card));
 if jsonb_array_length(cells)>1000 or exists(select 1 from jsonb_array_elements(cells)x
  where (x->>'row_number')::int>120 or length(x->>'row_label')>120)
 then return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false); end if;
 select coalesce(jsonb_agg(distinct g),'[]'::jsonb) into gaps from jsonb_array_elements(source->'bills')b
  cross join lateral jsonb_array_elements(b->'gaps')g;
 gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);
 if earned_card is null then gaps:=gaps||'["earned_card_performance_unknown"]'::jsonb; end if;
 gaps:=gaps||'["financial_review_required","full_business_totals_not_filled","new_old_customer_counts_unknown"]'::jsonb;
 if exists(select 1 from jsonb_array_elements(cells)x where x->>'cell_role'='staff_value'
  and x->>'column_code' in('dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment')
  and x->>'value' is null) then gaps:=gaps||'["project_or_platform_assignment_unresolved"]'::jsonb; end if;
 if draft.id is null then
  insert into public.zysyr_daily_sheet_drafts(company_id,store_id,report_date,source_voucher_id,source_sha256,
   ocr_provider,ocr_model,ocr_raw_result,created_by_user_id,updated_by_user_id)
  values(company,store,p_day,null,null,'frontdesk-autofill','frontdesk-autofill-v2','{}',null,null) returning * into draft;
  is_new:=true;
 end if;
 before_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id),'created',is_new);
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',c.id,'source_value',(x->>'value')::numeric)),'[]') into conflicts
 from public.zysyr_daily_sheet_cells c join jsonb_array_elements(cells)x
 on x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code
 where c.draft_id=draft.id and c.manual_override and c.corrected_numeric is distinct from (x->>'value')::numeric;
 if jsonb_array_length(conflicts)>0 then gaps:=gaps||'["manual_source_conflict"]'::jsonb; end if;
 -- User instruction 2026-09-30 supersedes the old blanket replacement consent.
 -- Authorized on 2026-09-28: update unposted drafts, including manual/image
 -- drafts. Keep cell IDs, change-history FKs, vouchers and attachments intact.
 -- Previous numeric staff candidates cannot be mixed with source employee rows.
 -- Exact pre-images remain in the immutable audit; never turn old money into counts.
 if draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then
  update public.zysyr_daily_sheet_cells c set ocr_numeric=null,corrected_numeric=null,
   ocr_text=null,manual_text=null,manual_override=false,updated_at=now(),updated_by_user_id=null
  where c.draft_id=draft.id and not c.manual_override and c.section_code in('stylist','technician')
   and c.cell_role not in('signature','unclosed_order','note');
 end if;
 for cell in select value from jsonb_array_elements(cells) loop
  insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,
   column_code,column_label,row_number,column_number,cell_role,ocr_text,ocr_numeric,source_method,updated_by_user_id)
  values(company,store,draft.id,cell->>'section_code',cell->>'row_key',cell->>'row_label',cell->>'column_code',cell->>'column_label',
   (cell->>'row_number')::int,(cell->>'column_number')::int,cell->>'cell_role',cell->>'value',(cell->>'value')::numeric,'frontdesk_autofill',null)
  on conflict(company_id,draft_id,section_code,row_key,column_code) do update
   set column_label=excluded.column_label,row_number=excluded.row_number,
    column_number=excluded.column_number,ocr_text=excluded.ocr_text,ocr_numeric=excluded.ocr_numeric,
    source_method='frontdesk_autofill',manual_override=false,corrected_numeric=null,manual_text=null,
    updated_by_user_id=null,updated_at=now()
   where not public.zysyr_daily_sheet_cells.manual_override;
  if found then n:=n+1; end if;
 end loop;
 -- Retire superseded machine values, but preserve every human edit.
 -- Unsupported payment/retail fields and text notes are outside the projection.
 update public.zysyr_daily_sheet_cells c set ocr_numeric=null,ocr_text=null,corrected_numeric=null,
  manual_override=false,manual_text=null,updated_at=now(),updated_by_user_id=null
 where c.draft_id=draft.id and not c.manual_override and c.source_method='frontdesk_autofill'
  and not exists(select 1 from jsonb_array_elements(cells)x where x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code);
 update public.zysyr_daily_sheet_drafts d set ocr_model='frontdesk-autofill-v2',template_code='zysyr_frontdesk_project_draft',
  ocr_raw_result=d.ocr_raw_result||jsonb_build_object('autofill',jsonb_build_object('snapshot_id',sid,
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v10','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'daily_total_policy','cash-plus-earned-card-v1',
   'manual_conflicts',conflicts,'recognition_policy','compare_only',
   'classification_issues',zysyr_daily_electronic_private.project_classification_issues(source),
   'known_absence_display','blank','cash_receipts',cash_projection->'metadata',
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct k),'[]'::jsonb) from (
    select x->>'row_key' k from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')
    union select c.row_key from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id
     and c.manual_override and c.section_code in('stylist','technician')) preserved_rows))),
  edit_revision=d.edit_revision+1,updated_by_user_id=null,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v10',draft.edit_revision,before_data,after_data,gaps);
 result:=jsonb_build_object('status','draft_filled','draft_id',draft.id,'snapshot_id',sid,'revision',draft.edit_revision,
  'cell_count',n,'filled_value_count',(select count(*) from jsonb_array_elements(cells)x where x->>'value' is not null),
  'needs_finance_review',true,'automatic_posting_enabled',false,'formal_ledger_amount_changed',false);
 insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
 values(p_shop,p_day,sid,result) on conflict(shop_name,business_date) do update
  set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
 return result;
end $$;
revoke all on function public.mgj_autofill_daily_sheet(text,date) from public,anon,authenticated;
grant execute on function public.mgj_autofill_daily_sheet(text,date) to service_role;
