-- Candidate-only performance evidence fix. Original payment gaps remain.
-- No posted data, public permissions, MGJ writes or automatic posting changes.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function zysyr_daily_electronic_private.platform_item_routes(p_bill jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 routes jsonb:='{}'; p jsonb; i jsonb; platform_field text; platform_code text;
 platform_amount numeric; platform_count int; positive_count int;
 pay_sum numeric; item_sum numeric; complete boolean; performance_route_verified boolean; ids text[]; amounts numeric[];
 n int; mask int; winner int:=0; matches int:=0; j int; candidate numeric;
begin
 for i in select value from jsonb_array_elements(p_bill->'items') loop
  routes:=routes||jsonb_build_object(i->>'source_item_id','project');
 end loop;
 select count(*) filter(where (x->>'amount_cents')::numeric>0),
  count(*) filter(where (x->>'amount_cents')::numeric>0 and x->>'source_label' in('大众点评','抖音')),
  bool_and(x->>'amount_cents' is not null and (x->>'amount_cents')::numeric>=0),
  sum((x->>'amount_cents')::numeric)
 into positive_count,platform_count,complete,pay_sum from jsonb_array_elements(p_bill->'payments')x;
 if platform_count=0 and not exists(select 1 from jsonb_array_elements(p_bill->'payments')x
  where x->>'source_label' in('大众点评','抖音') and x->>'amount_cents' is null) then return routes; end if;
 -- Unknown platform amounts, refunds, changing channel names and multiple
 -- platforms are unresolved; no ratio splitting and no arbitrary first match.
 routes:='{}';
 for i in select value from jsonb_array_elements(p_bill->'items') loop
  routes:=routes||jsonb_build_object(i->>'source_item_id','review');
 end loop;
 if platform_count<>1 then return routes; end if;
 select x into p from jsonb_array_elements(p_bill->'payments')x
  where (x->>'amount_cents')::numeric>0 and x->>'source_label' in('大众点评','抖音');
 platform_field:=p->>'source_field'; platform_amount:=(p->>'amount_cents')::numeric;
 platform_code:=case when platform_field='dianpin' and p->>'source_label'='大众点评' then 'dianping_group'
  when platform_field='otherfee2' and p->>'source_label'='抖音' then 'douyin' end;
 if platform_code is null then return routes; end if;
 -- Missing noncash totals stay missing. This exception classifies EMPLOYEE
 -- PERFORMANCE only: one actual project, one verified platform payer, exact
 -- cash closure and explicit cash-only allocation components for every row.
 -- It never fills card/credit totals with zero or marks the bill/report complete.
 performance_route_verified:=coalesce(complete,false);
 if not performance_route_verified then
  performance_route_verified:=positive_count=1
   and jsonb_array_length(p_bill->'items')=1
   and jsonb_array_length(p_bill->'employee_allocations')>0
   and (p_bill->'items'->0->>'amount_cents')::numeric=(p_bill->>'source_posted_amount_cents')::numeric
   and pay_sum=(p_bill->>'source_posted_amount_cents')::numeric
   and not exists(select 1 from jsonb_array_elements(p_bill->'payments')x
    where (x->>'amount_cents')::numeric<0 or (x->>'amount_cents' is null
     and (x->>'source_field' is null or x->>'source_field' not in('cardfee','presentfee','treatfee','treatpresentfee','dividefee','offlineCreditPay','onlineCreditPay'))))
   and not exists(select 1 from jsonb_array_elements(p_bill->'employee_allocations')a
    where a->>'performance_cents' is null or (a->>'performance_cents')::numeric<0
     or (a->>'cash_performance_cents')::numeric is distinct from (a->>'performance_cents')::numeric
     or (a->>'card_performance_cents')::numeric is distinct from 0
     or (a->>'other_performance_cents')::numeric is distinct from 0
     or a->>'source_item_id' is distinct from (p_bill->'items'->0->>'source_item_id'));
 end if;
 if not coalesce(performance_route_verified,false) then return routes; end if;

 if positive_count=1 then
  if pay_sum is distinct from (p_bill->>'source_posted_amount_cents')::numeric then return routes; end if;
  for i in select value from jsonb_array_elements(p_bill->'items') loop
   routes:=routes||jsonb_build_object(i->>'source_item_id',platform_code);
  end loop;
  return routes;
 end if;
 -- Mixed cases require complete, nonnegative actual item amounts, exact bill
 -- closure and supported ordinary cash channels. Price is never performance.
 if exists(select 1 from jsonb_array_elements(p_bill->'items')x
  where x->>'amount_cents' is null or (x->>'amount_cents')::numeric<0)
 or exists(select 1 from jsonb_array_elements(p_bill->'payments')x where (x->>'amount_cents')::numeric>0
  and x->>'source_field' not in('cash','pay','weixin',platform_field)) then return routes; end if;
 select sum((x->>'amount_cents')::numeric),
  array_agg(x->>'source_item_id' order by x->>'source_item_id') filter(where (x->>'amount_cents')::numeric>0),
  array_agg((x->>'amount_cents')::numeric order by x->>'source_item_id') filter(where (x->>'amount_cents')::numeric>0)
 into item_sum,ids,amounts from jsonb_array_elements(p_bill->'items')x;
 n:=coalesce(cardinality(ids),0);
 if n<1 or n>12 or item_sum is distinct from pay_sum
 or pay_sum is distinct from (p_bill->>'source_posted_amount_cents')::numeric then return routes; end if;
 for mask in 1..((1<<n)-1) loop
  candidate:=0;
  for j in 1..n loop if (mask & (1<<(j-1)))<>0 then candidate:=candidate+amounts[j]; end if; end loop;
  if candidate=platform_amount then matches:=matches+1;winner:=mask; end if;
  if matches>1 then return routes; end if;
 end loop;
 if matches<>1 then return routes; end if;
 for i in select value from jsonb_array_elements(p_bill->'items') loop
  routes:=routes||jsonb_build_object(i->>'source_item_id','project');
 end loop;
 for j in 1..n loop if (winner & (1<<(j-1)))<>0 then routes:=routes||jsonb_build_object(ids[j],platform_code); end if; end loop;
 return routes;
end $$;
revoke all on function zysyr_daily_electronic_private.platform_item_routes(jsonb) from public,anon,authenticated,service_role;

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3'));

create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 source jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
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
 if (select count(*) from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft')>1 then return jsonb_build_object('status','multiple_drafts_preserved','automatic_posting_enabled',false); end if;
 select * into draft from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
  and d.report_date=p_day and d.status='draft' for update;
 -- Recheck after waiting on an existing row lock: finance may have confirmed it.
 if exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store
   and d.report_date=p_day and d.status='confirmed') then return jsonb_build_object('status','confirmed_preserved','automatic_posting_enabled',false); end if;
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v3'
 then return jsonb_build_object('status','already_applied','draft_id',draft.id,'automatic_posting_enabled',false); end if;
 cells:=zysyr_daily_electronic_private.autofill_cells(source);
 if jsonb_array_length(cells)>1000 or exists(select 1 from jsonb_array_elements(cells)x
  where (x->>'row_number')::int>120 or length(x->>'row_label')>120)
 then return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false); end if;
 select coalesce(jsonb_agg(distinct g),'[]'::jsonb) into gaps from jsonb_array_elements(source->'bills')b
  cross join lateral jsonb_array_elements(b->'gaps')g;
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
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v3','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'known_absence_display','blank',
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct x->>'row_key'),'[]'::jsonb)
    from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')))),
  edit_revision=d.edit_revision+1,updated_by_user_id=null,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v3',draft.edit_revision,before_data,after_data,gaps);
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
