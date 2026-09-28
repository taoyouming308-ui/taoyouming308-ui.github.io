-- PREPARED ONLY: unposted cash-receipt candidates, never automatic posting.
-- Apply only after explicit review, baseline backup and finance release gates.
set statement_timeout='30s';
set lock_timeout='5s';
alter table public.zysyr_daily_electronic_snapshots drop constraint zysyr_daily_electronic_snapshots_source_scope_check;
alter table public.zysyr_daily_electronic_snapshots add constraint zysyr_daily_electronic_snapshots_source_scope_check check(source_scope in('projects_daily_summary','all_business_daily_summary','operating_daily_summary','card_sales_daily_summary'));
create or replace function zysyr_daily_electronic_private.daily_electronic_summary_candidate(
  p_company_id uuid,p_store_id uuid,p_business_date date,p_source_scope text,p_source jsonb
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_shop text := zysyr_daily_electronic_private.daily_electronic_shop(p_company_id,p_store_id);
  v_content jsonb; v_query jsonb; v_row jsonb; v_top jsonb; v_period text;
  v_headers jsonb := '["日期","总额","现金","银联","支付宝","微信支付","大众点评","商场卡","合作券","口碑","抖音","总额","划卡","划赠送金","划分期赠送金","总额","代金券","欠款","免单","红包","优惠券","商城订单","线上积分抵扣","门店积分抵扣"]';
  v_codes text[] := array['cash_total','cash','unionpay','alipay','wechat','dianpin','mall','cooperation','koubei','douyin',
    'card_total','card_principal','card_present','card_installment_present','noncash_total','voucher','debt','free_order','red_packet','coupon','mall_order','online_points','offline_points'];
  v_cents bigint[] := array[]::bigint[];
  v_cells jsonb := '[]'; v_groups jsonb := '[]'; v_unknown jsonb := '[]';
  v_gaps jsonb := '[{"code":"source_shop_not_echoed","blocking":true},{"code":"employee_detail_unavailable","blocking":true},{"code":"project_mapping_unavailable","blocking":true},{"code":"financial_review_required","blocking":true}]';
  v_i integer; v_j integer; v_group integer; v_start integer; v_finish integer; v_sum numeric;
  v_missing integer; v_total bigint; v_delta numeric; v_section text; v_value bigint;
begin
  if p_source_scope is null or p_source_scope not in ('projects_daily_summary','all_business_daily_summary','operating_daily_summary','card_sales_daily_summary') then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_source) is distinct from 'object' or
    not (p_source ?& array['shop_id','business_date','query','content']) or
    (p_source - array['shop_id','business_date','query','content']) <> '{}'::jsonb or
    jsonb_typeof(p_source->'shop_id') is distinct from 'string' or
    p_source->>'shop_id' is distinct from v_shop or
    p_source->>'business_date' is distinct from p_business_date::text then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_ENVELOPE_INVALID';
  end if;
  v_query := p_source->'query'; v_content := p_source->'content';
  v_period := ((extract(epoch from (p_business_date::timestamp at time zone 'UTC'))*1000)::bigint)::text;
  if jsonb_typeof(v_query) is distinct from 'object' or
    not (v_query ?& array['parentShopId','shopId','shopIds','period','incomeType','depcode']) or
    (v_query - array['parentShopId','shopId','shopIds','period','incomeType','depcode']) <> '{}'::jsonb or
    v_query->>'parentShopId' is distinct from '1103470' or
    coalesce(v_query->>'shopId','') not in ('1103470','1009951','1837032') or
    v_query->'shopIds' is distinct from jsonb_build_array(v_shop) or
    v_query->>'period' is distinct from v_period || '_' || v_period or
    v_query->>'depcode' is distinct from '-1' or
    v_query->'incomeType' is distinct from (case when p_source_scope='projects_daily_summary'
      then '["1"]'::jsonb when p_source_scope='operating_daily_summary' then '["1","2"]'::jsonb when p_source_scope='card_sales_daily_summary' then '["3","4","5"]'::jsonb else '["1","2","3","4","5"]'::jsonb end) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_QUERY_SCOPE_MISMATCH';
  end if;
  if jsonb_typeof(v_content) is distinct from 'object' or
    not (v_content ?& array['head','headTop','data','columns','config']) or
    (v_content - array['head','headTop','data','columns','config']) <> '{}'::jsonb or
    v_content->'head' is distinct from v_headers or
    v_content->'config' is distinct from '{"title":"门店营业日汇总"}'::jsonb then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_typeof(v_content->'headTop') is distinct from 'array' or
    jsonb_array_length(v_content->'headTop') <> 4 or
    jsonb_typeof(v_content->'columns') is distinct from 'array' or
    jsonb_array_length(v_content->'columns') <> 24 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  for v_i in 0..3 loop
    v_top := v_content->'headTop'->v_i;
    if jsonb_typeof(v_top) is distinct from 'object' or
      (v_top - array['text',case when v_i=0 then 'rowspan' else 'colspan' end]) <> '{}'::jsonb or
      v_top->>'text' is distinct from (array['日期','现金类','划卡类','其他非现类'])[v_i+1] or
      v_top->>(case when v_i=0 then 'rowspan' else 'colspan' end) is distinct from (array['2','10','4','9'])[v_i+1] then
      raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_content->'columns') column_value
    where jsonb_typeof(column_value) not in ('null','object')) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_typeof(v_content->'data') is distinct from 'array' then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_STRUCTURE_CHANGED';
  end if;
  if jsonb_array_length(v_content->'data')=0 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SOURCE_NO_ROWS';
  end if;
  if jsonb_array_length(v_content->'data')<>1 then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_MULTIPLE_ROWS';
  end if;
  v_row := v_content->'data'->0;
  if jsonb_typeof(v_row) is distinct from 'array' or jsonb_array_length(v_row)<>24 or
    v_row->>0 is distinct from p_business_date::text then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_SUMMARY_DATE_MISMATCH';
  end if;
  for v_i in 1..23 loop
    v_value := zysyr_daily_electronic_private.daily_electronic_cents(v_row->v_i);
    v_cents := array_append(v_cents,v_value);
    v_section := case when v_i <= 10 then 'source_cash' when v_i <= 14 then 'source_card' else 'source_noncash' end;
    v_cells := v_cells || jsonb_build_array(jsonb_build_object(
      'section_code',v_section,'column_code',v_codes[v_i],'label',v_headers->>v_i,
      'value_cents',v_value,'value',v_value::numeric/100,'unit','CNY',
      'status',case when v_value is null then 'unknown' else 'source_reference' end,
      'lineage',jsonb_build_object('json_pointer','/content/data/0/'||v_i::text,'source_header',v_headers->>v_i,
        'source_column_index',v_i,'source_scope',p_source_scope),
      'formal_cell_target',null));
    if v_value is null then v_unknown := v_unknown || to_jsonb(v_codes[v_i]); end if;
  end loop;
  foreach v_section in array array['public_card','public_qr','private_card','private_qr'] loop
    v_cells := v_cells || jsonb_build_array(jsonb_build_object('section_code','payment','column_code',v_section,
      'value',null,'value_cents',null,'status','not_applicable','blocking',false,
      'lineage',jsonb_build_object('policy','user_excluded_four_account_columns'),'formal_cell_target',null));
  end loop;
  for v_group in 1..3 loop
    v_start := (array[1,11,15])[v_group]; v_finish := (array[10,14,23])[v_group];
    v_total := v_cents[v_start]; v_sum := 0; v_missing := case when v_total is null then 1 else 0 end;
    for v_j in v_start+1..v_finish loop
      if v_cents[v_j] is null then v_missing:=v_missing+1; else v_sum:=v_sum+v_cents[v_j]; end if;
    end loop;
    v_delta := case when v_missing=0 then v_total-v_sum else null end;
    v_groups := v_groups || jsonb_build_array(jsonb_build_object('group',(array['cash','card','noncash'])[v_group],
      'total_cents',v_total,'known_component_sum_cents',v_sum,'unknown_count',v_missing,
      'delta_cents',v_delta,'matched',case when v_missing=0 then v_delta=0 else null end));
    if v_delta is not null and v_delta<>0 then
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object('code','source_group_mismatch',
        'group',(array['cash','card','noncash'])[v_group],'blocking',true,'delta_cents',v_delta));
    end if;
  end loop;
  if jsonb_array_length(v_unknown)>0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object('code','source_fields_unknown','blocking',true,'fields',v_unknown));
  end if;
  if p_source_scope='all_business_daily_summary' then
    v_gaps := v_gaps || '[{"code":"all_business_total_is_not_cash_performance","blocking":true}]'::jsonb;
  end if;
  return jsonb_build_object('status','needs_review','stage','source_only','mapping_version','mgj-summary-source-only-v1',
    'scope_verified',false,'scope_verification','request_only','source_scope',p_source_scope,
    'source_shape_valid',true,'financially_complete',false,'automatic_posting_allowed',false,
    'cash_total_reference_cents',v_cents[1],'cells',v_cells,'controls',v_groups,'gaps',v_gaps);
end
$$;
revoke all on function zysyr_daily_electronic_private.daily_electronic_summary_candidate(uuid,uuid,date,text,jsonb)
  from public,anon,authenticated,service_role;


create or replace function zysyr_daily_electronic_private.read_daily_electronic_source(
  p_company_id uuid,p_store_id uuid,p_date_from date,p_date_to date,p_source_scope text,p_candidate_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='DAILY_ELECTRONIC_SERVICE_REQUIRED';
  end if;
  perform zysyr_daily_electronic_private.daily_electronic_shop(p_company_id,p_store_id);
  if p_date_from is null or p_date_to is null or p_date_from<date '2026-01-01' or p_date_to>date '2026-12-31'
    or p_date_to<p_date_from or p_date_to-p_date_from>30 or
    (p_source_scope is not null and p_source_scope not in ('projects_daily_summary','all_business_daily_summary','operating_daily_summary','card_sales_daily_summary')) then
    raise exception using errcode='22023',message='DAILY_ELECTRONIC_READ_RANGE_INVALID';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_id',s.id,'candidate_id',c.id,'business_date',s.business_date,
    'source_scope',s.source_scope,'source_sha256',s.source_sha256,'version',s.version,'fetched_at',s.fetched_at,
    'latest_fetched_at',h.latest_fetched_at,'latest',h.snapshot_id=s.id,'status',c.status,'stage',c.stage,
    'mapping_version',c.mapping_version,'scope_verified',false,'scope_verification','request_only',
    'cash_total_reference_cents',c.candidate_payload->'cash_total_reference_cents',
    'controls',c.candidate_payload->'controls','gaps',c.candidate_payload->'gaps') ||
    case when p_candidate_id is not null then jsonb_build_object('source_payload',s.source_payload,'candidate_payload',c.candidate_payload)
      else '{}'::jsonb end order by s.business_date,s.source_scope),'[]'::jsonb) into v_items
  from public.zysyr_daily_electronic_snapshots s
  join public.zysyr_daily_electronic_candidates c on c.snapshot_id=s.id and c.company_id=s.company_id and c.store_id=s.store_id
  join public.zysyr_daily_electronic_heads h on h.company_id=s.company_id and h.store_id=s.store_id and h.business_date=s.business_date and h.source_scope=s.source_scope
  where s.company_id=p_company_id and s.store_id=p_store_id and s.business_date between p_date_from and p_date_to
    and (p_source_scope is null or s.source_scope=p_source_scope)
    and ((p_candidate_id is null and h.candidate_id=c.id) or c.id=p_candidate_id);
  if p_candidate_id is not null and jsonb_array_length(v_items)=0 then
    raise exception using errcode='P0002',message='DAILY_ELECTRONIC_CANDIDATE_NOT_FOUND';
  end if;
  return jsonb_build_object('items',v_items,'stage','source_only','formal_ledger_amount_changed',false);
end
$$;
revoke all on function zysyr_daily_electronic_private.read_daily_electronic_source(uuid,uuid,date,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function zysyr_daily_electronic_private.read_daily_electronic_source(uuid,uuid,date,date,text,uuid) to service_role;

create function zysyr_daily_electronic_private.cash_receipt_projection(p_company uuid,p_store uuid,p_day date)
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
 foreach i in array array[3,7,8,9] loop
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
 metadata:=metadata||jsonb_build_object('state','candidate','scope_verified',false,'scope_verification','request_only',
  'operating_fetched_at',op_time,'all_fetched_at',all_time,'card_sales_fetched_at',card_time,
  'cash_channels_complete',not (gaps ? 'cash_channels_unknown' or gaps ? 'unmapped_external_cash_channel'),
  'automatic_posting_allowed',false,'new_card_cash_formula','direct_card_sales_external_cash');
 return jsonb_build_object('available',true,'cells',cells,'gaps',gaps,'metadata',metadata);
end $$;
revoke all on function zysyr_daily_electronic_private.cash_receipt_projection(uuid,uuid,date) from public,anon,authenticated,service_role;

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4'));
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
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v4'
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
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v4','gaps',gaps,
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
 values(company,store,draft.id,sid,'frontdesk-autofill-v4',draft.edit_revision,before_data,after_data,gaps);
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

create function zysyr_daily_electronic_private.cash_source_autofill_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare shop text; projection jsonb; result jsonb; detail_sid uuid;
begin
 if new.source_scope not in('operating_daily_summary','all_business_daily_summary','card_sales_daily_summary') then return new; end if;
 shop:=case new.store_id when 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid then '自由手艺人'
  when '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid then '向里造型' end;
 begin
  projection:=zysyr_daily_electronic_private.cash_receipt_projection(new.company_id,new.store_id,new.business_date);
  if projection->'available'='true'::jsonb then
   result:=public.mgj_autofill_daily_sheet(shop,new.business_date);
  end if;
 exception when others then
   select h.snapshot_id into detail_sid from public.mgj_business_detail_heads h where h.shop_name=shop and h.business_date=new.business_date;
   if detail_sid is not null then
    insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
     values(shop,new.business_date,detail_sid,jsonb_build_object('status','cash_projection_failed','automatic_posting_enabled',false))
     on conflict(shop_name,business_date) do update set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
   else
    -- Status FK must refer to a BUSINESS snapshot, never substitute a summary
    -- snapshot or fabricate an identity. Safe operational log if none exists.
    raise log 'ZYSYR_CASH_PROJECTION_FAILED: % %',shop,new.business_date;
   end if;
 end;
 return new;
end $$;
revoke all on function zysyr_daily_electronic_private.cash_source_autofill_trigger() from public,anon,authenticated,service_role;
create trigger zysyr_cash_source_autofill after insert or update on public.zysyr_daily_electronic_heads
 for each row execute function zysyr_daily_electronic_private.cash_source_autofill_trigger();

-- The stylist section's displayed grand subtotal is an independent control.
-- Previously it could disagree with the employee detail while validation passed.
create or replace function zysyr_private.daily_sheet_validation(
  p_company_id uuid, p_store_id uuid, p_draft_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_atomic numeric := 0;
  v_staff_reported numeric := 0;
  v_category_reported numeric := 0;
  v_stylist_subtotal numeric;
  v_stylist_subtotal_count integer := 0;
  v_actual numeric;
  v_grand numeric;
  v_payment_methods numeric := 0;
  v_cashflow numeric;
  v_card_consumption numeric := 0;
  v_payment_total numeric;
  v_row_mismatches integer := 0;
  v_category_mismatches integer := 0;
  v_atomic_count integer := 0;
  v_missing_controls text[] := array[]::text[];
  v_valid boolean;
  v_cash_mode boolean:=false; v_card_sales numeric; v_cash_metadata jsonb; v_cash_source_current boolean:=false;
begin
  if not exists (select 1 from public.zysyr_daily_sheet_drafts draft
    where draft.company_id = p_company_id and draft.store_id = p_store_id and draft.id = p_draft_id) then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;

  select draft.ocr_raw_result#>'{autofill,cash_receipts}' into v_cash_metadata
  from public.zysyr_daily_sheet_drafts draft where draft.company_id=p_company_id and draft.store_id=p_store_id and draft.id=p_draft_id;
  v_cash_mode:=coalesce(v_cash_metadata->>'policy'='operating-external-cash-v1' and v_cash_metadata->>'state'='candidate',false);
  if v_cash_mode then
    select zysyr_private.daily_sheet_cell_value(cell) into v_card_sales
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id
      and cell.section_code='summary' and cell.row_key='summary' and cell.column_code='card_subtotal';
    v_cash_source_current:=exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id and d.status='confirmed')
      or v_cash_metadata is not distinct from (zysyr_daily_electronic_private.cash_receipt_projection(p_company_id,p_store_id,
        (select report_date from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id and store_id=p_store_id))->'metadata');
  end if;

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0),
    count(*) filter (where zysyr_private.daily_sheet_cell_value(cell) is not null)
    into v_staff_atomic, v_atomic_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_value';

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_staff_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'staff_total';

  select count(*) into v_row_mismatches from (
    select cell.row_key,
      coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_value'), 0) as atomic_total,
      max(zysyr_private.daily_sheet_cell_value(cell)) filter (where cell.cell_role = 'staff_total') as reported_total
    from public.zysyr_daily_sheet_cells cell
    where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
      and cell.section_code = 'stylist'
    group by cell.row_key
  ) row_control
  where (row_control.atomic_total <> 0 or row_control.reported_total is not null)
    and (row_control.reported_total is null or abs(row_control.atomic_total - row_control.reported_total) > 0.01);

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_category_reported
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.cell_role = 'category_total';

  select count(*) into v_category_mismatches from (
    select category.column_code, coalesce(atomic.atomic_total, 0) as atomic_total,
      zysyr_private.daily_sheet_cell_value(category) as reported_total
    from public.zysyr_daily_sheet_cells category
    left join lateral (
      select sum(zysyr_private.daily_sheet_cell_value(cell)) as atomic_total
      from public.zysyr_daily_sheet_cells cell
      where cell.company_id = category.company_id and cell.store_id = category.store_id
        and cell.draft_id = category.draft_id and cell.cell_role = 'staff_value'
        and cell.column_code = category.column_code
    ) atomic on true
    where category.company_id = p_company_id and category.store_id = p_store_id
      and category.draft_id = p_draft_id and category.cell_role = 'category_total'
  ) category_control
  where (category_control.atomic_total <> 0 or category_control.reported_total is not null)
    and (category_control.reported_total is null or abs(category_control.atomic_total - category_control.reported_total) > 0.01);

  select max(zysyr_private.daily_sheet_cell_value(cell)), count(*)
    into v_stylist_subtotal, v_stylist_subtotal_count
  from public.zysyr_daily_sheet_cells cell
  where cell.company_id = p_company_id and cell.store_id = p_store_id and cell.draft_id = p_draft_id
    and cell.section_code = 'stylist' and cell.row_key = 'stylist_category_total'
    and cell.column_code = 'subtotal' and cell.cell_role = 'summary_value';

  select zysyr_private.daily_sheet_cell_value(cell) into v_actual
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_actual' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_grand
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'summary_grand' limit 1;
  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0) into v_payment_methods
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_method';
  select zysyr_private.daily_sheet_cell_value(cell) into v_cashflow
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_cashflow' limit 1;
  select coalesce(zysyr_private.daily_sheet_cell_value(cell), 0) into v_card_consumption
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_card_consumption' limit 1;
  select zysyr_private.daily_sheet_cell_value(cell) into v_payment_total
  from public.zysyr_daily_sheet_cells cell where cell.company_id = p_company_id and cell.store_id = p_store_id
    and cell.draft_id = p_draft_id and cell.cell_role = 'payment_total' limit 1;

  if v_actual is null then v_missing_controls := array_append(v_missing_controls, '实做'); end if;
  if v_grand is null then v_missing_controls := array_append(v_missing_controls, '总计'); end if;
  if v_cashflow is null then v_missing_controls := array_append(v_missing_controls, '现金流'); end if;
  if v_payment_total is null then v_missing_controls := array_append(v_missing_controls, '支付总计'); end if;
  if v_atomic_count = 0 then v_missing_controls := array_append(v_missing_controls, '员工明细'); end if;
  if v_stylist_subtotal_count <> 1 or v_stylist_subtotal is null then
    v_missing_controls := array_append(v_missing_controls, '造型区总小计');
  end if;

  if v_cash_mode and v_card_sales is null then v_missing_controls:=array_append(v_missing_controls,'卡类新收款小计'); end if;
  if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb) then
    v_missing_controls:=array_append(v_missing_controls,'现金收款来源核对');
  end if;
  v_valid := cardinality(v_missing_controls) = 0
    and v_row_mismatches = 0 and v_category_mismatches = 0
    and v_staff_atomic > 0
    and abs(v_staff_atomic - v_staff_reported) <= 0.01
    and abs(v_staff_atomic - v_category_reported) <= 0.01
    and abs(v_staff_atomic - v_stylist_subtotal) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and (case when v_cash_mode then
      abs(v_actual-v_cashflow)<=0.01 and abs(v_actual+v_card_sales-v_grand)<=0.01
      and abs(v_grand-v_payment_total)<=0.01
    else abs(v_staff_atomic-v_actual)<=0.01 and abs(v_staff_atomic-v_grand)<=0.01
      and abs(v_cashflow+v_card_consumption-v_payment_total)<=0.01 and abs(v_staff_atomic-v_payment_total)<=0.01 end);

  return jsonb_build_object(
    'valid', v_valid,
    'staff_atomic_total', round(v_staff_atomic, 2),
    'staff_reported_total', round(v_staff_reported, 2),
    'category_reported_total', round(v_category_reported, 2),
    'stylist_subtotal', v_stylist_subtotal,
    'stylist_subtotal_mismatch', v_stylist_subtotal is null or abs(v_staff_atomic - v_stylist_subtotal) > 0.01,
    'actual_total', v_actual,
    'grand_total', v_grand,
    'payment_method_total', round(v_payment_methods, 2),
    'cashflow_total', v_cashflow,
    'card_consumption', round(v_card_consumption, 2),
    'payment_total', v_payment_total,
    'staff_row_mismatches', v_row_mismatches,
    'category_mismatches', v_category_mismatches,
    'missing_controls', to_jsonb(v_missing_controls),
    'tolerance', 0.01,
    'cash_policy',case when v_cash_mode then 'operating-external-cash-v1' else null end,
    'income_source',case when v_cash_mode then 'operating_external_cash_receipts' else 'nonzero_stylist_atomic_cells_only' end
  );
end
$$;

revoke execute on function zysyr_private.daily_sheet_validation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
