-- Preview/apply only existing numeric draft cells. Reuse the audited revision
-- writer; never run the scheduled autofill writer or any posting operation.
create function public.zysyr_correct_daily_draft_from_source(
 p_company_id uuid,p_store_id uuid,p_actor_user_id uuid,p_draft_id uuid,
 p_day date,p_expected_revision integer,p_source_token text,p_selected uuid[]
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 d public.zysyr_daily_sheet_drafts%rowtype;
 shop text; s jsonb; projected jsonb; candidates jsonb; token text;
 edits jsonb; saved jsonb; applying boolean:=p_selected is not null;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='DAILY_DRAFT_SOURCE_SERVICE_ONLY'; end if;
 if p_expected_revision is null or p_expected_revision not between 0 and 2147483646 or p_actor_user_id is null
  or p_draft_id is null or p_day is null then
  raise exception using errcode='22023',message='DAILY_DRAFT_SOURCE_SCOPE_INVALID'; end if;
 perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
 if p_company_id='02463a53-dfdb-4291-b04d-dd1d85f9d998'::uuid then
  shop:=case p_store_id when 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid then '自由手艺人'
       when '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid then '向里造型' end;
 end if;
 if shop is null or p_day<date '2026-01-01' or p_day>date '2026-12-31'
  or p_day>(now() at time zone 'Asia/Shanghai')::date then
  return jsonb_build_object('status','source_unavailable'); end if;
 if applying then
  if cardinality(p_selected) not between 1 and 1000
   or (select count(distinct x) from unnest(p_selected) x)<>cardinality(p_selected)
   or coalesce(p_source_token,'') !~ '^[a-f0-9]{64}$' then
   raise exception using errcode='22023',message='DAILY_DRAFT_SOURCE_CONFIRMATION_INVALID'; end if;
  -- Match ingestion's lock order: live bill list, immutable source head, draft.
  perform 1 from public.mgj_daily_consumption where shop_name=shop and business_date=p_day for share;
  if not found then return jsonb_build_object('status','source_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended('mgj_business:'||shop||':'||p_day,0));
  perform pg_advisory_xact_lock(hashtextextended('daily_autofill:'||p_store_id||':'||p_day,0));
  select * into d from public.zysyr_daily_sheet_drafts
   where company_id=p_company_id and store_id=p_store_id and id=p_draft_id and report_date=p_day for update;
 else
  select * into d from public.zysyr_daily_sheet_drafts
   where company_id=p_company_id and store_id=p_store_id and id=p_draft_id and report_date=p_day;
 end if;
 if d.id is null or d.edit_revision<>p_expected_revision then return jsonb_build_object('status','draft_changed'); end if;
 if d.status<>'draft' or zysyr_private.period_is_locked(p_company_id,p_store_id,p_day)
  or exists(select 1 from public.zysyr_daily_reports r where r.company_id=p_company_id and r.store_id=p_store_id
    and r.report_date=p_day and r.status in ('submitted','approved'))
  or exists(select 1 from public.zysyr_daily_sheet_drafts f where f.company_id=p_company_id and f.store_id=p_store_id
    and f.report_date=p_day and f.status='confirmed') then
  return jsonb_build_object('status','not_editable'); end if;
 s:=public.mgj_read_business_details(shop,p_day);
 if s->'available' is distinct from 'true'::jsonb or s->'source_list_changed' is distinct from 'false'::jsonb
  or s->>'shop' is distinct from shop or s->>'date' is distinct from p_day::text
  or s->>'source_scope' is distinct from 'project_consumption'
  or s->>'snapshot_id' is null or coalesce(s->>'source_sha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(s->'bills') is distinct from 'array' then
  return jsonb_build_object('status','source_unavailable'); end if;
 if jsonb_array_length(s->'bills') not between 1 and 1000 then return jsonb_build_object('status','source_unavailable'); end if;
 if exists(select 1 from jsonb_array_elements(s->'bills') b
  where (b->'gaps') ?| array['empfees_missing','details_missing','signed_adjustment_requires_review']
   or ((b->>'source_posted_amount_cents')::numeric>0 and jsonb_array_length(b->'employee_allocations')=0)) then
  return jsonb_build_object('status','source_unavailable'); end if;
 projected:=zysyr_daily_electronic_private.autofill_cells(s);
 if jsonb_array_length(projected)>1000 then return jsonb_build_object('status','source_unavailable'); end if;
 -- Use original source IDs and the same category rules as autofill. A positive
 -- partial sum is not evidence of the complete employee amount: if any of that
 -- employee's allocations cannot be mapped, do not suggest changes for them.
 with bills as (
  select b,zysyr_daily_electronic_private.platform_item_routes(b) routes from jsonb_array_elements(s->'bills') b
 ), allocations as (
  select a->>'employee_id' employee_id,btrim(a->>'employee_name') employee_name,a->>'source_role' role,
   case when routes->>(i->>'source_item_id')='project' then
    zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name')
    when routes->>(i->>'source_item_id') in('dianping_group','douyin') then routes->>(i->>'source_item_id') end category,
   (a->>'performance_cents')::numeric cents
  from bills cross join lateral jsonb_array_elements(b->'employee_allocations') a
  left join lateral (select j from jsonb_array_elements(b->'items') j
    where j->>'source_item_id'=a->>'source_item_id') item(i) on true
 ), source_rows as (
  select employee_id,min(employee_name) name, min(role) role
  from allocations where nullif(employee_id,'') is not null and role ~ '设计师|发型师'
  group by employee_id
  having count(distinct employee_name)=1 and count(distinct role)=1
   and bool_and(employee_name is not null and employee_name<>'')
   and bool_and(cents is not null and cents>=0 and (cents=0 or category is not null))
 ), targets as (
  select c.*,case when manual_override then corrected_numeric else ocr_numeric end before_value
  from public.zysyr_daily_sheet_cells c where company_id=p_company_id and store_id=p_store_id
   and draft_id=p_draft_id and section_code='stylist' and cell_role='staff_value'
 ), eligible as (
  select c.id,c.row_label,c.column_label,c.row_number,c.column_number,c.before_value,(v->>'value')::numeric suggested
  from targets c join source_rows r on r.name=btrim(c.row_label)
  join lateral (select v from jsonb_array_elements(projected) v
   where v->>'section_code'='stylist' and v->>'cell_role'='staff_value'
    and v->>'row_key'='stylist_e'||r.employee_id||'_'||substr(md5(r.role),1,8)
    and v->>'column_code'=c.column_code
    and replace(btrim(v->>'column_label'),'／','/')=replace(btrim(c.column_label),'／','/')) ref on true
  where c.column_code in ('dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment')
   and c.before_value>=0 and (v->>'value')::numeric>0 and (v->>'value')::numeric<=999999999999.99
   and (v->>'value')::numeric<>c.before_value and round((v->>'value')::numeric,2)=(v->>'value')::numeric
   and (select count(distinct t.row_key) from targets t where btrim(t.row_label)=r.name)=1
   and (select count(distinct a.employee_id) from allocations a where a.employee_name=r.name)=1
   and not exists(select 1 from allocations a where (nullif(a.employee_id,'') is null
     or coalesce(a.role,'')='' or coalesce(a.employee_name,'')='')
     and (a.employee_id=r.employee_id or a.employee_name=r.name or coalesce(a.employee_name,'')='')
     and a.cents is distinct from 0)
 )
 select coalesce(jsonb_agg(jsonb_build_object('cell_id',id,'row_label',row_label,'column_label',column_label,
 'before_value',before_value,'suggested_value',suggested) order by row_number,column_number,id),'[]'::jsonb)
 into candidates from eligible;
 token:=encode(sha256(convert_to(jsonb_build_array(p_company_id,p_store_id,p_actor_user_id,p_draft_id,
  p_day,p_expected_revision,s->>'snapshot_id',s->>'source_sha256',candidates)::text,'UTF8')),'hex');
 if not applying then
  return jsonb_build_object('status','preview','draft_id',d.id,'revision',d.edit_revision,'source_token',token,
   'source_fetched_at',s->>'fetched_at','items',candidates);
 end if;
 if p_source_token is distinct from token then return jsonb_build_object('status','source_changed'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'cell_id','value',x->'suggested_value') order by x->>'cell_id'),'[]'::jsonb)
  into edits from jsonb_array_elements(candidates) x where (x->>'cell_id')::uuid=any(p_selected);
 if jsonb_array_length(edits)<>cardinality(p_selected) then
  raise exception using errcode='22023',message='DAILY_DRAFT_SOURCE_SELECTION_INVALID'; end if;
 saved:=public.zysyr_save_daily_sheet_cells(p_actor_user_id,p_company_id,p_store_id,p_draft_id,edits,
  '财务勾选纠正日报草稿；收银项目来源版本 '||(s->>'snapshot_id')||'；来源指纹 '||(s->>'source_sha256'),p_expected_revision);
 if saved->>'draft_id' is distinct from d.id::text or (saved->>'revision')::integer is distinct from p_expected_revision+1
  or (saved->>'changed_cells')::integer is distinct from cardinality(p_selected) then
  raise exception 'DAILY_DRAFT_SOURCE_SAVE_RECEIPT_INVALID'; end if;
 return jsonb_build_object('status','saved','draft_id',d.id,'revision',p_expected_revision+1,
  'changed_cells',cardinality(p_selected),'formal_ledger_amount_changed',false);
end $$;
revoke all on function public.zysyr_correct_daily_draft_from_source(uuid,uuid,uuid,uuid,date,integer,text,uuid[])
 from public,anon,authenticated;
grant execute on function public.zysyr_correct_daily_draft_from_source(uuid,uuid,uuid,uuid,date,integer,text,uuid[])
 to service_role;
