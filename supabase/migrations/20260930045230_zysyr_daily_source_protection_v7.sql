-- v7: confirmed care route, source/recognition separation, human edits preserved.
-- No source/posted data changes. Original source and immutable before/after audit retained.
set statement_timeout='30s';
set lock_timeout='5s';

create or replace function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
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
 ('1009951','523','歌薇酸护（盖白发）880','treatment')
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;

create or replace function zysyr_daily_electronic_private.autofill_cells(p_source jsonb)
returns jsonb language sql immutable set search_path='' as $$
with bills as (select b,zysyr_daily_electronic_private.platform_item_routes(b) routes from jsonb_array_elements(p_source->'bills') b),
lines as (
 select b->>'source_bill_id' visit_key,a->>'employee_id' employee_id,a->>'employee_name' employee_name,a->>'source_role' role,
  (a->>'performance_cents')::numeric/100 performance,
  (a->>'source_project_count')::numeric project_count,
  i->>'item_name' item_name,
  zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name') category,
  case when routes->>(i->>'source_item_id')='project' then
    zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name')
   when routes->>(i->>'source_item_id') in('dianping_group','douyin') then routes->>(i->>'source_item_id')
   else null end stylist_category
 from bills cross join lateral jsonb_array_elements(b->'employee_allocations') a
 left join lateral (select x from jsonb_array_elements(b->'items')x
   where x->>'source_item_id'=a->>'source_item_id') item on true
 cross join lateral (select item.x i) named
), staff as (
 select employee_id,role,min(employee_name) name,
  count(distinct employee_name)=1 and min(employee_name)<>'' name_verified,
  case when role ~ '技师|技工' then 'technician' when role ~ '设计师|发型师' then 'stylist' else null end section,
  case when count(performance)=count(*) and min(performance)>=0 then sum(performance) end subtotal
 from lines group by employee_id,role
), ranked as (
 select *,row_number() over(partition by section order by employee_id,role)::int position from staff
 where section is not null and employee_id is not null and name_verified
), columns as (
 select * from (values
 ('stylist','dianping_group','点评团',1),('stylist','douyin','抖音',2),
 ('stylist','wash_cut_blow','洗剪吹',3),('stylist','makeup_styling','彩妆/造型',4),
 ('stylist','perm','烫发',5),('stylist','color','染发',6),('stylist','treatment','护理',7),
 ('stylist','technical_care','技护',8),('stylist','scalp_care','头皮护理',9),
 ('stylist','beirou_care','倍柔护理',10),('stylist','extensions','接发',11),
 ('stylist','retail','美发零售',12),('stylist','essence_products','精华产品',13),
 ('stylist','wig_custom','假发定制/发片',14),('stylist','beauty_aids','美发辅助品',15),
 ('stylist','makeup_jewelry','彩妆+首饰',16),('stylist','home_fragrance','家居品和香氛',17),
 ('stylist','subtotal','小计',19),
 ('technician','perm_count','烫（个）',1),('technician','dye_count','染（个）',7),
 ('technician','care_count','护（个）',13),('technician','subtotal','烫染护合计（个）',19)
 )t(section,code,label,col)
), category_values as (
 select r.section,r.employee_id,r.role,c.code,
  case when c.code='subtotal' and r.section='stylist' then r.subtotal
   when r.section='stylist' and c.code in('dianping_group','douyin','makeup_styling','wash_cut_blow','perm','color','treatment') then
    case when count(l.employee_id)=0 and not exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.stylist_category is null and u.performance is distinct from 0) then 0
     when count(l.performance)=count(*) and min(l.performance)>=0 then sum(l.performance) end
   when r.section='technician' then
    case when c.code='subtotal' and exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.category is null and u.project_count is distinct from 0) then null
     when count(l.employee_id)=0 and not exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.category is null and u.project_count is distinct from 0) then 0
     when count(l.project_count)=count(*) and min(l.project_count)>=0
      and bool_and(l.project_count=trunc(l.project_count)) then case when c.code='subtotal' then count(distinct (l.visit_key,l.category)) filter(where l.project_count>0)
       else count(distinct l.visit_key) filter(where l.project_count>0) end end end value
 from ranked r join columns c on c.section=r.section
 left join lines l on l.employee_id=r.employee_id and l.role=r.role and
   (c.code='subtotal' and (r.section='stylist' or l.category in('perm','color','treatment'))
    or r.section='stylist' and l.stylist_category=c.code
    or r.section='technician' and l.category=case c.code when 'perm_count' then 'perm' when 'dye_count' then 'color'
     when 'care_count' then 'treatment' else null end)
 group by r.section,r.employee_id,r.role,c.code,r.subtotal
), detail_cells as (
 select r.section,r.section||'_e'||r.employee_id||'_'||substr(md5(r.role),1,8) row_key,r.name row_label,c.code,c.label,
  case when r.section='stylist' then 2+r.position else 14+greatest(0,(select count(*) from ranked where section='stylist')-8)+r.position end row_no,
  c.col+1 col_no,
  case when r.section='stylist' then case when c.code='subtotal' then 'staff_total' else 'staff_value' end
   else case when c.code='subtotal' then 'technician_total' else 'technician_value' end end cell_role,v.value
 from ranked r join columns c on c.section=r.section
 join category_values v on v.section=r.section and v.employee_id=r.employee_id and v.role=r.role and v.code=c.code
), totals as (
 select c.section,c.section||'_category_total' row_key,'小计' row_label,c.code,c.label,
  case when c.section='stylist' then 12+greatest(0,(select count(*) from ranked where section='stylist')-8)
   else 21+greatest(0,(select count(*) from ranked where section='stylist')-8)
     +greatest(0,(select count(*) from ranked where section='technician')-6) end row_no,
  c.col+1 col_no,case when c.section='stylist' then case when c.code='subtotal' then 'summary_value' else 'category_total' end
   else case when c.code='subtotal' then 'technician_total' else 'technician_category_total' end end cell_role,
  case when count(d.value)=count(d.code) and count(d.code)>0 then sum(d.value) end value
 from columns c left join detail_cells d on d.section=c.section and d.code=c.code
 group by c.section,c.code,c.label,c.col
), pay_columns as (
 select * from(values('cash','现金','cash',1),('alipay','支付宝','pay',6),
 ('wechat','微信','weixin',7),('douyin','抖音','otherfee2',8),('group_buy','团购','dianpin',9)) t(code,label,source_field,col)
), pay_cells as (
 select 'payment' section,'payment' row_key,'支付' row_label,c.code,c.label,33 row_no,c.col col_no,
  'payment_method' cell_role,
  case when count(p->>'amount_cents')=(select count(*) from bills) and min((p->>'amount_cents')::numeric)>=0
   and bool_and(c.source_field='cash' or p->>'source_label'=case c.source_field
     when 'pay' then '支付宝' when 'weixin' then '微信' when 'dianpin' then '大众点评' when 'otherfee2' then '抖音' end)
   then sum((p->>'amount_cents')::numeric)/100 end value
 from pay_columns c left join (select p from bills cross join lateral jsonb_array_elements(b->'payments')p) payments
  on p->>'source_field'=c.source_field group by c.code,c.label,c.col,c.source_field
), result as (
 select * from detail_cells union all select * from totals union all select * from pay_cells
 union all select 'summary','summary','汇总','stylist_total','发型师栏',30,1,'summary_value',
  case when count(subtotal)=count(*) and count(*)>0 then sum(subtotal) end from ranked where section='stylist'
)
select coalesce(jsonb_agg(jsonb_build_object('section_code',section,'row_key',row_key,'row_label',row_label,
 'column_code',code,'column_label',label,'row_number',row_no,'column_number',col_no,
 'cell_role',cell_role,'value',value) order by row_no,col_no),'[]'::jsonb) from result
$$;
revoke all on function zysyr_daily_electronic_private.autofill_cells(jsonb) from public,anon,authenticated,service_role;

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6','frontdesk-autofill-v7'));

create or replace function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 company uuid:='02463a53-dfdb-4291-b04d-dd1d85f9d998'; store uuid;
 source jsonb; cash_projection jsonb; cells jsonb; gaps jsonb; sid uuid; draft public.zysyr_daily_sheet_drafts;
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
 if draft.id is not null and draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2')
  and exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override
   and c.section_code in('stylist','technician')) then
  return jsonb_build_object('status','manual_draft_preserved','draft_id',draft.id,'needs_finance_review',true,'automatic_posting_enabled',false);
 end if;
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2' and (select e.mapping_version from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)='frontdesk-autofill-v7'
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
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v7','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'manual_conflicts',conflicts,'recognition_policy','compare_only',
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
 values(company,store,draft.id,sid,'frontdesk-autofill-v7',draft.edit_revision,before_data,after_data,gaps);
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

create or replace function zysyr_private.daily_sheet_has_sync(p_draft uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft and
  (d.template_code='zysyr_frontdesk_project_draft' or d.ocr_provider='frontdesk-autofill' or d.ocr_raw_result ? 'autofill'))
 or exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=p_draft and c.source_method='frontdesk_autofill')
 or exists(select 1 from public.zysyr_daily_autofill_events e where e.draft_id=p_draft)
$$;
revoke all on function zysyr_private.daily_sheet_has_sync(uuid) from public,anon,authenticated,service_role;

create or replace function public.zysyr_apply_daily_sheet_recognition_candidates(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
  p_voucher_id uuid,p_expected_revision integer,p_candidates jsonb,p_model text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_draft public.zysyr_daily_sheet_drafts; v_voucher public.zysyr_voucher_attachments; v_item jsonb; v_cell public.zysyr_daily_sheet_cells;
  v_value numeric; v_confidence numeric; v_text text; v_saved integer:=0; v_text_saved integer:=0; v_names_saved integer:=0; v_manual_skipped integer:=0;
  v_compare boolean; v_diff jsonb:='[]'; v_current numeric; v_old_text text;
  v_revision integer; v_validation jsonb; v_numeric jsonb; v_texts jsonb; v_names jsonb;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  v_numeric:=coalesce(p_candidates->'cells','[]'::jsonb); v_texts:=coalesce(p_candidates->'text_cells','[]'::jsonb); v_names:=coalesce(p_candidates->'row_names','[]'::jsonb);
  if jsonb_typeof(p_candidates)<>'object' or jsonb_typeof(v_numeric)<>'array' or jsonb_typeof(v_texts)<>'array' or jsonb_typeof(v_names)<>'array'
    or jsonb_array_length(v_numeric)+jsonb_array_length(v_texts)+jsonb_array_length(v_names) not between 1 and 1200 or nullif(btrim(p_model),'') is null
  then raise exception using errcode='22023',message='DAILY_RECOGNITION_INPUT_INVALID'; end if;
  select * into v_draft from public.zysyr_daily_sheet_drafts where company_id=p_company_id and store_id=p_store_id and id=p_draft_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_SHEET_DRAFT_NOT_FOUND'; end if;
  if v_draft.status<>'draft' then raise exception using errcode='55000',message='DAILY_SHEET_DRAFT_NOT_EDITABLE'; end if;
  if v_draft.edit_revision<>p_expected_revision then raise exception using errcode='40001',message='DAILY_SHEET_CHANGED_RELOAD'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,v_draft.report_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  select * into v_voucher from public.zysyr_voucher_attachments where company_id=p_company_id and store_id=p_store_id and id=p_voucher_id and audit_status='approved' and document_type='daily_report';
  if not found then raise exception using errcode='P0002',message='APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  if not(v_draft.source_voucher_id=p_voucher_id or exists(select 1 from public.zysyr_daily_sheet_attachments where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and voucher_id=p_voucher_id and attachment_kind='original_report'))
  then raise exception using errcode='42501',message='DAILY_VOUCHER_NOT_LINKED'; end if;

  v_compare:=zysyr_private.daily_sheet_has_sync(p_draft_id);
  -- A new full-table pass replaces only older machine candidates. Human edits stay untouched.
  update public.zysyr_daily_sheet_cells set ocr_numeric=null,ocr_text=null,confidence=null,source_method='blank_template',updated_by_user_id=p_actor_user_id,updated_at=now()
   where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and not manual_override and not v_compare
     and source_method in ('openai_vision_candidate','kimi_vision_candidate','codex_local_candidate');

  for v_item in select value from jsonb_array_elements(v_numeric) loop
    if coalesce(v_item->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_INVALID'; end if;
    select * into v_cell from public.zysyr_daily_sheet_cells where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and id=(v_item->>'id')::uuid for update;
    if not found or v_cell.cell_role in ('signature','unclosed_order','note') then raise exception using errcode='22023',message='DAILY_RECOGNITION_CELL_INVALID'; end if;
    v_value:=nullif(v_item->>'value','')::numeric; v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if v_value is null or v_value<0 or v_value>999999999999.99 or v_confidence is null or v_confidence not between 0 and 1 then raise exception using errcode='22023',message='DAILY_RECOGNITION_VALUE_INVALID'; end if;
    if v_compare then
      v_current:=case when v_cell.manual_override then v_cell.corrected_numeric else v_cell.ocr_numeric end;
      if v_current is distinct from v_value then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'cell_id',v_cell.id,'name',v_cell.row_label,'column',v_cell.column_label,'current',v_current,'recognized',v_value,'confidence',v_confidence)); end if;
    elsif v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_numeric=v_value,ocr_text=v_value::text,confidence=v_confidence,source_method='codex_local_candidate',updated_by_user_id=p_actor_user_id,updated_at=now() where id=v_cell.id;
      v_saved:=v_saved+1;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_texts) loop
    if coalesce(v_item->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='DAILY_RECOGNITION_TEXT_INVALID'; end if;
    select * into v_cell from public.zysyr_daily_sheet_cells where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and id=(v_item->>'id')::uuid for update;
    v_text:=nullif(btrim(v_item->>'value'),''); v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if not found or v_cell.cell_role not in ('unclosed_order','note') or v_text is null or char_length(v_text)>500 or v_confidence is null or v_confidence not between 0 and 1 then raise exception using errcode='22023',message='DAILY_RECOGNITION_TEXT_INVALID'; end if;
    if v_compare then
      v_old_text:=case when v_cell.manual_override then v_cell.manual_text else v_cell.ocr_text end;
      if v_old_text is distinct from v_text then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'cell_id',v_cell.id,'name',v_cell.row_label,'column',v_cell.column_label,'current',v_old_text,'recognized',v_text,'confidence',v_confidence)); end if;
    elsif v_cell.manual_override then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set ocr_text=v_text,confidence=v_confidence,source_method='codex_local_candidate',updated_by_user_id=p_actor_user_id,updated_at=now() where id=v_cell.id;
      v_text_saved:=v_text_saved+1;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_names) loop
    v_text:=nullif(btrim(v_item->>'name'),''); v_confidence:=nullif(v_item->>'confidence','')::numeric;
    if (v_item->>'section') not in ('stylist','technician','product') or coalesce(v_item->>'row_key','') !~ '^[a-z0-9_]{1,80}$'
      or v_text is null or char_length(v_text)>120 or v_confidence is null or v_confidence not between 0 and 1
    then raise exception using errcode='22023',message='DAILY_RECOGNITION_NAME_INVALID'; end if;
    if v_compare then
      select min(row_label) into v_old_text from public.zysyr_daily_sheet_cells
       where draft_id=p_draft_id and company_id=p_company_id and store_id=p_store_id
       and section_code=v_item->>'section' and row_key=v_item->>'row_key';
      if v_old_text is null then raise exception 'DAILY_RECOGNITION_NAME_INVALID'; end if;
      if v_old_text is distinct from v_text then v_diff:=v_diff||jsonb_build_array(jsonb_build_object(
       'name',v_old_text,'column','姓名','current',v_old_text,'recognized',v_text,'confidence',v_confidence)); end if;
    elsif exists(select 1 from public.zysyr_daily_sheet_cell_changes ch join public.zysyr_daily_sheet_cells c on c.id=ch.cell_id
      where ch.company_id=p_company_id and ch.store_id=p_store_id and ch.draft_id=p_draft_id and c.section_code=v_item->>'section' and c.row_key=v_item->>'row_key' and ch.before_label is distinct from ch.after_label)
    then v_manual_skipped:=v_manual_skipped+1; else
      update public.zysyr_daily_sheet_cells set row_label=v_text,row_label_source_method='codex_local_candidate',row_label_confidence=v_confidence,updated_by_user_id=p_actor_user_id,updated_at=now()
       where company_id=p_company_id and store_id=p_store_id and draft_id=p_draft_id and section_code=v_item->>'section' and row_key=v_item->>'row_key';
      if found then v_names_saved:=v_names_saved+1; end if;
    end if;
  end loop;
  if v_compare then
    insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
    values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'daily_recognition_comparison_saved',
     jsonb_build_object('revision',v_draft.edit_revision),jsonb_build_object('revision',v_draft.edit_revision,'voucher_id',p_voucher_id,
      'model',btrim(p_model),'comparison_only',true,'differences',v_diff),'同步日报原图只读对照；没有写入表格','financial');
    return jsonb_build_object('draft_id',p_draft_id,'revision',v_draft.edit_revision,'saved_cells',0,'saved_text_cells',0,'saved_row_names',0,
     'comparison_only',true,'differences',v_diff,'difference_count',jsonb_array_length(v_diff),'formal_data_unchanged',true);
  end if;
  v_revision:=v_draft.edit_revision+1; v_validation:=zysyr_private.daily_sheet_validation(p_company_id,p_store_id,p_draft_id);
  update public.zysyr_daily_sheet_drafts set edit_revision=v_revision,validation_result=v_validation,ocr_provider='codex-local',ocr_model=btrim(p_model),updated_by_user_id=p_actor_user_id,updated_at=now() where id=p_draft_id;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','daily_sheet_draft',p_draft_id,'daily_full_recognition_candidates_saved',jsonb_build_object('revision',v_draft.edit_revision),
    jsonb_build_object('revision',v_revision,'voucher_id',p_voucher_id,'provider','codex-local','model',btrim(p_model),'numeric_cells',v_saved,'text_cells',v_text_saved,'row_names',v_names_saved,'manual_cells_preserved',v_manual_skipped,'validation',v_validation),
    '本机Codex整张原图候选已保存，等待财务逐格核对并最终确认','financial');
  return jsonb_build_object('draft_id',p_draft_id,'revision',v_revision,'saved_cells',v_saved,'saved_text_cells',v_text_saved,'saved_row_names',v_names_saved,'manual_cells_preserved',v_manual_skipped,'validation',v_validation,'provider','codex-local');
end $$;
revoke all on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text) to service_role;

-- Expand legacy daily-sheet staff grids before image recognition.
-- Blank rows are copied from the existing section template; no manual value or
-- machine candidate is overwritten. The function stays behind operations-api.
set statement_timeout = '30s';
set lock_timeout = '5s';

create or replace function public.zysyr_expand_daily_sheet_staff_rows(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_store_id uuid,
  p_draft_id uuid,
  p_expected_revision integer,
  p_stylist_rows integer,
  p_technician_rows integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.zysyr_daily_sheet_drafts;
  v_section text;
  v_target integer;
  v_existing integer;
  v_next_index integer;
  v_template_key text;
  v_added integer := 0;
  v_stylist_added integer := 0;
  v_technician_added integer := 0;
  v_revision integer;
  v_validation jsonb;
begin
  perform zysyr_private.assert_finance_scope(
    p_actor_user_id, p_company_id, p_store_id, 'daily_report.write'
  );

  if p_stylist_rows not between 1 and 20
    or p_technician_rows not between 1 and 20 then
    raise exception using errcode = '22023', message = 'DAILY_STAFF_ROW_TARGET_INVALID';
  end if;

  select * into v_draft
  from public.zysyr_daily_sheet_drafts
  where company_id = p_company_id
    and store_id = p_store_id
    and id = p_draft_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'DAILY_SHEET_DRAFT_NOT_FOUND';
  end if;
  if v_draft.status <> 'draft' then
    raise exception using errcode = '55000', message = 'DAILY_SHEET_DRAFT_NOT_EDITABLE';
  end if;
  if v_draft.edit_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'DAILY_SHEET_CHANGED_RELOAD';
  end if;
  if zysyr_private.period_is_locked(p_company_id, p_store_id, v_draft.report_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  if zysyr_private.daily_sheet_has_sync(p_draft_id) then
    return jsonb_build_object('draft_id',p_draft_id,'revision',v_draft.edit_revision,'added_rows',0,'comparison_only',true);
  end if;
  for v_section, v_target in
    select * from (values
      ('stylist'::text, p_stylist_rows),
      ('technician'::text, p_technician_rows)
    ) as targets(section_code, target_rows)
  loop
    select count(distinct row_key),
           max(nullif((pg_catalog.regexp_match(row_key, '_(\d+)$'))[1], '')::integer),
           (array_agg(row_key order by row_number, row_key))[1]
      into v_existing, v_next_index, v_template_key
    from public.zysyr_daily_sheet_cells
    where company_id = p_company_id
      and store_id = p_store_id
      and draft_id = p_draft_id
      and section_code = v_section
      and row_key not in ('stylist_category_total', 'technician_category_total', 'company');

    if v_template_key is null then
      raise exception using errcode = 'P0002', message = 'DAILY_STAFF_ROW_TEMPLATE_NOT_FOUND';
    end if;

    v_existing := coalesce(v_existing, 0);
    v_next_index := greatest(coalesce(v_next_index, 0), v_existing);

    while v_existing < v_target loop
      v_next_index := v_next_index + 1;

      insert into public.zysyr_daily_sheet_cells(
        company_id, store_id, draft_id, section_code, row_key, row_label,
        column_code, column_label, row_number, column_number, cell_role,
        ocr_text, ocr_numeric, corrected_numeric, manual_override, confidence,
        bbox, source_method, updated_by_user_id, updated_at, manual_text,
        row_label_source_method, row_label_confidence
      )
      select
        p_company_id, p_store_id, p_draft_id, v_section,
        v_section || '_' || v_next_index::text,
        '第' || v_next_index::text || '行',
        column_code, column_label,
        case when v_section = 'stylist' then 2 + v_next_index else 14 + v_next_index end,
        column_number, cell_role,
        null, null, null, false, null,
        null, 'blank_template', p_actor_user_id, now(), null,
        'template', null
      from public.zysyr_daily_sheet_cells
      where company_id = p_company_id
        and store_id = p_store_id
        and draft_id = p_draft_id
        and section_code = v_section
        and row_key = v_template_key;

      if not found then
        raise exception using errcode = 'P0002', message = 'DAILY_STAFF_ROW_TEMPLATE_NOT_FOUND';
      end if;

      v_existing := v_existing + 1;
      v_added := v_added + 1;
      if v_section = 'stylist' then
        v_stylist_added := v_stylist_added + 1;
      else
        v_technician_added := v_technician_added + 1;
      end if;
    end loop;
  end loop;

  if v_added = 0 then
    return jsonb_build_object(
      'draft_id', p_draft_id,
      'revision', v_draft.edit_revision,
      'added_rows', 0,
      'added_stylist_rows', 0,
      'added_technician_rows', 0
    );
  end if;

  update public.zysyr_daily_sheet_cells
  set row_number = 4 + p_stylist_rows,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and draft_id = p_draft_id
    and section_code = 'stylist'
    and row_key = 'stylist_category_total';

  update public.zysyr_daily_sheet_cells
  set row_number = 15 + p_technician_rows,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and draft_id = p_draft_id
    and section_code = 'technician'
    and row_key = 'technician_category_total';

  v_revision := v_draft.edit_revision + 1;
  v_validation := zysyr_private.daily_sheet_validation(
    p_company_id, p_store_id, p_draft_id
  );

  update public.zysyr_daily_sheet_drafts
  set edit_revision = v_revision,
      validation_result = v_validation,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id
    and store_id = p_store_id
    and id = p_draft_id;

  insert into public.zysyr_audit_events(
    company_id, store_id, actor_type, actor_user_id, channel,
    entity_type, entity_id, action, before_json, after_json, reason, sensitivity
  ) values (
    p_company_id, p_store_id, 'user', p_actor_user_id, 'api',
    'daily_sheet_draft', p_draft_id, 'daily_staff_rows_auto_expanded',
    jsonb_build_object('revision', v_draft.edit_revision),
    jsonb_build_object(
      'revision', v_revision,
      'added_rows', v_added,
      'added_stylist_rows', v_stylist_added,
      'added_technician_rows', v_technician_added,
      'stylist_target_rows', p_stylist_rows,
      'technician_target_rows', p_technician_rows,
      'validation', v_validation
    ),
    '识别前按当前门店在职岗位人数自动补充空白员工行',
    'financial'
  );

  return jsonb_build_object(
    'draft_id', p_draft_id,
    'revision', v_revision,
    'added_rows', v_added,
    'added_stylist_rows', v_stylist_added,
    'added_technician_rows', v_technician_added,
    'validation', v_validation
  );
end
$$;

revoke all on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) to service_role;

comment on function public.zysyr_expand_daily_sheet_staff_rows(
  uuid, uuid, uuid, uuid, integer, integer, integer
) is 'Service-only adaptive staff-row expansion before candidate recognition; inserts blanks only and preserves manual edits.';
