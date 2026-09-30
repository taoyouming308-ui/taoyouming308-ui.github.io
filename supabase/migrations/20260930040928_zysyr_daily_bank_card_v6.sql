-- User approved an independent 银行卡 payment column on 2026-09-30.
-- Candidate-only; original source, confirmed sheets and account columns unchanged.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function zysyr_daily_electronic_private.cash_receipt_projection(p_company uuid,p_store uuid,p_day date)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 op public.zysyr_daily_electronic_snapshots; allsrc public.zysyr_daily_electronic_snapshots; cardsrc public.zysyr_daily_electronic_snapshots;
 op_time timestamptz; all_time timestamptz; card_time timestamptz; op_view jsonb; all_view jsonb; card_view jsonb;
 op_row jsonb; all_row jsonb; op_cash bigint; all_cash bigint; new_cards bigint;
 cells jsonb:='[]'; gaps jsonb:='["source_shop_not_echoed","financial_review_required"]';
 metadata jsonb; i int; n bigint; section text; code text; label text; role_code text; col int;
begin
 perform zysyr_daily_electronic_private.daily_electronic_shop(p_company,p_store);
 select s.* into op from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='operating_daily_summary';
 select h.latest_fetched_at into op_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='operating_daily_summary';
 select s.* into allsrc from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='all_business_daily_summary';
 select h.latest_fetched_at into all_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='all_business_daily_summary';
 select s.* into cardsrc from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='card_sales_daily_summary';
 select h.latest_fetched_at into card_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='card_sales_daily_summary';
 metadata:=jsonb_build_object('policy','operating-external-cash-v1','state','unavailable',
  'operating_snapshot_id',op.id,'operating_sha256',op.source_sha256,
  'all_snapshot_id',allsrc.id,'all_sha256',allsrc.source_sha256,'card_sales_snapshot_id',cardsrc.id,'card_sales_sha256',cardsrc.source_sha256);
 if op.id is null or allsrc.id is null or cardsrc.id is null then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_missing"]'::jsonb);
 end if;
 -- Use current head watermarks, not the original creation time of a reused
 -- identical immutable snapshot. No invented freshness or source verification.
 if extract(epoch from greatest(op_time,all_time,card_time)-least(op_time,all_time,card_time))>120 or
  (p_day=(now() at time zone 'Asia/Shanghai')::date and least(op_time,all_time,card_time)<now()-interval '30 minutes') then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_pair_stale"]'::jsonb);
 end if;
 op_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'operating_daily_summary',op.source_payload);
 all_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'all_business_daily_summary',allsrc.source_payload);
 card_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'card_sales_daily_summary',cardsrc.source_payload);
 if exists(select 1 from jsonb_array_elements(op_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb)
  or exists(select 1 from jsonb_array_elements(all_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb)
  or exists(select 1 from jsonb_array_elements(card_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb) then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_group_mismatch"]'::jsonb);
 end if;
 op_row:=op.source_payload#>'{content,data,0}'; all_row:=allsrc.source_payload#>'{content,data,0}';
 for i in 1..10 loop
  if zysyr_daily_electronic_private.daily_electronic_cents(op_row->i)>zysyr_daily_electronic_private.daily_electronic_cents(all_row->i) then
   return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_pair_decreasing"]'::jsonb);
  end if;
 end loop;
 op_cash:=(op_view->>'cash_total_reference_cents')::bigint; all_cash:=(all_view->>'cash_total_reference_cents')::bigint;
 new_cards:=(card_view->>'cash_total_reference_cents')::bigint;
 -- Never infer card sales by subtraction: an intervening PROJECT receipt can
 -- change the all-business total. Independent source closure must agree.
 if op_cash is not null and all_cash is not null and new_cards is not null and op_cash+new_cards<>all_cash then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_partition_mismatch"]'::jsonb);
 end if;
 if op_cash is null or all_cash is null or new_cards is null then gaps:=gaps||'["cash_total_unknown"]'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(op_view->'cells')x where x->>'section_code'='source_cash' and x->>'value_cents' is null) then
  gaps:=gaps||'["cash_channels_unknown"]'::jsonb;
 end if;
 foreach i in array array[7,8,9] loop
  if zysyr_daily_electronic_private.daily_electronic_cents(op_row->i)>0 then gaps:=gaps||'["unmapped_external_cash_channel"]'::jsonb; exit; end if;
 end loop;
 if new_cards>0 then gaps:=gaps||'["card_sales_category_split_unavailable"]'::jsonb; end if;
 for i in 1..10 loop
  section:=case when i<=3 then 'summary' else 'payment' end;
  code:=(array['actual_total','card_subtotal','grand_total','cash_flow','total','cash','alipay','wechat','group_buy','douyin'])[i];
  label:=(array['实做','卡类小计','总计','现金流','总计','现金','支付宝','微信','团购','抖音'])[i];
  role_code:=(array['summary_actual','summary_value','summary_grand','payment_cashflow','payment_total','payment_method','payment_method','payment_method','payment_method','payment_method'])[i];
  col:=(array[5,9,10,10,12,1,6,7,9,8])[i];
  n:=case i when 1 then op_cash when 2 then new_cards when 3 then all_cash when 4 then op_cash when 5 then all_cash
   else zysyr_daily_electronic_private.daily_electronic_cents(op_row->((array[0,0,0,0,0,2,4,5,6,10])[i])) end;
  cells:=cells||jsonb_build_array(jsonb_build_object('section_code',section,'row_key',section,
   'row_label',case when section='summary' then '汇总' else '支付' end,'column_code',code,'column_label',label,
   'row_number',case when section='summary' then 30 else 33 end,'column_number',col,'cell_role',role_code,'value',n::numeric/100));
 end loop;
 -- User-approved independent 银联 channel; never classify as public/private
 -- account, stored-value drawdown, WeChat or Alipay. Unknown stays unknown.
 n:=zysyr_daily_electronic_private.daily_electronic_cents(op_row->3);
 cells:=cells||jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment',
  'row_label','支付','column_code','bank_card','column_label','银行卡','row_number',33,
  'column_number',8,'cell_role','payment_method','value',n::numeric/100));
 metadata:=metadata||jsonb_build_object('state','candidate','scope_verified',false,'scope_verification','request_only',
  'operating_fetched_at',op_time,'all_fetched_at',all_time,'card_sales_fetched_at',card_time,
  'cash_channels_complete',not (gaps ? 'cash_channels_unknown' or gaps ? 'unmapped_external_cash_channel'),
  'automatic_posting_allowed',false,'new_card_cash_formula','direct_card_sales_external_cash');
 return jsonb_build_object('available',true,'cells',cells,'gaps',gaps,'metadata',metadata);
end $$;
revoke all on function zysyr_daily_electronic_private.cash_receipt_projection(uuid,uuid,date) from public,anon,authenticated,service_role;

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6'));

create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 source jsonb; cash_projection jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
 before_data jsonb; after_data jsonb; cell jsonb; result jsonb; n integer:=0; is_new boolean:=false;
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
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v6'
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
 if jsonb_array_length(cells)>1000 or exists(select 1 from jsonb_array_elements(cells)x
  where (x->>'row_number')::int>120 or length(x->>'row_label')>120)
 then return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false); end if;
 select coalesce(jsonb_agg(distinct g),'[]'::jsonb) into gaps from jsonb_array_elements(source->'bills')b
  cross join lateral jsonb_array_elements(b->'gaps')g;
 gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);
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
 -- Authorized on 2026-09-28: update unposted drafts, including manual/image
 -- drafts. Keep cell IDs, change-history FKs, vouchers and attachments intact.
 -- Previous numeric staff candidates cannot be mixed with source employee rows.
 -- Exact pre-images remain in the immutable audit; never turn old money into counts.
 if draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then
  update public.zysyr_daily_sheet_cells c set ocr_numeric=null,corrected_numeric=null,
   ocr_text=null,manual_text=null,manual_override=false,updated_at=now(),updated_by_user_id=null
  where c.draft_id=draft.id and c.section_code in('stylist','technician')
   and c.cell_role not in('signature','unclosed_order','note');
 end if;
 for cell in select value from jsonb_array_elements(cells) loop
  insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,row_label,
   column_code,column_label,row_number,column_number,cell_role,ocr_text,ocr_numeric,source_method,updated_by_user_id)
  values(company,store,draft.id,cell->>'section_code',cell->>'row_key',cell->>'row_label',cell->>'column_code',cell->>'column_label',
   (cell->>'row_number')::int,(cell->>'column_number')::int,cell->>'cell_role',cell->>'value',(cell->>'value')::numeric,'frontdesk_autofill',null)
  on conflict(company_id,draft_id,section_code,row_key,column_code) do update
   set row_label=excluded.row_label,column_label=excluded.column_label,row_number=excluded.row_number,
    column_number=excluded.column_number,ocr_text=excluded.ocr_text,ocr_numeric=excluded.ocr_numeric,
    source_method='frontdesk_autofill',manual_override=false,corrected_numeric=null,manual_text=null,
    updated_by_user_id=null,updated_at=now();
  if found then n:=n+1; end if;
 end loop;
 -- A superseded source value must not survive, even under a manual override.
 -- Unsupported payment/retail fields and text notes are outside the projection.
 update public.zysyr_daily_sheet_cells c set ocr_numeric=null,ocr_text=null,corrected_numeric=null,
  manual_override=false,manual_text=null,updated_at=now(),updated_by_user_id=null
 where c.draft_id=draft.id and c.source_method='frontdesk_autofill'
  and not exists(select 1 from jsonb_array_elements(cells)x where x->>'section_code'=c.section_code and x->>'row_key'=c.row_key and x->>'column_code'=c.column_code);
 update public.zysyr_daily_sheet_drafts d set ocr_model='frontdesk-autofill-v2',template_code='zysyr_frontdesk_project_draft',
  ocr_raw_result=d.ocr_raw_result||jsonb_build_object('autofill',jsonb_build_object('snapshot_id',sid,
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v6','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'known_absence_display','blank','cash_receipts',cash_projection->'metadata',
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct x->>'row_key'),'[]'::jsonb)
    from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')))),
  edit_revision=d.edit_revision+1,updated_by_user_id=null,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v6',draft.edit_revision,before_data,after_data,gaps);
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
