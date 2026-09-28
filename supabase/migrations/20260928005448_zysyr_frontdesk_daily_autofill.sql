-- Unposted, review-required drafts from the SAME private source as frontdesk.
-- No account impersonation, voucher fabrication, posting or client grants.
set statement_timeout='30s';
set lock_timeout='5s';

-- Machine authorship is recorded in an immutable service audit, not a fake user.
alter table public.zysyr_daily_sheet_drafts alter column created_by_user_id drop not null;
alter table public.zysyr_daily_sheet_drafts alter column updated_by_user_id drop not null;
alter table public.zysyr_daily_sheet_cells alter column updated_by_user_id drop not null;
alter table public.zysyr_daily_sheet_drafts add constraint daily_autofill_machine_creator
 check(created_by_user_id is not null or ocr_provider='frontdesk-autofill');
alter table public.zysyr_daily_sheet_cells drop constraint zysyr_daily_sheet_cells_source_method_check;
alter table public.zysyr_daily_sheet_cells add constraint zysyr_daily_sheet_cells_source_method_check
 check(source_method in('openai_vision','openai_vision_candidate','codex_local_candidate',
 'kimi_vision','kimi_vision_candidate','paddle_ocr','blank_template','frontdesk_autofill'));

create table public.zysyr_daily_autofill_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null, store_id uuid not null, draft_id uuid not null,
 snapshot_id uuid not null references public.mgj_business_detail_snapshots(id) on delete restrict,
 mapping_version text not null check(mapping_version='frontdesk-autofill-v1'),
 revision integer not null, before_snapshot jsonb not null, after_snapshot jsonb not null,
 review_gaps jsonb not null, actor_type text not null default 'service' check(actor_type='service'),
 created_at timestamptz not null default now(),
 unique(draft_id,revision),
 foreign key(company_id,store_id,draft_id) references public.zysyr_daily_sheet_drafts(company_id,store_id,id) on delete restrict
);
alter table public.zysyr_daily_autofill_events enable row level security;
alter table public.zysyr_daily_autofill_events force row level security;
create index daily_autofill_events_source_idx on public.zysyr_daily_autofill_events(snapshot_id);
create index daily_autofill_events_scope_idx on public.zysyr_daily_autofill_events(company_id,store_id,draft_id);
revoke all on public.zysyr_daily_autofill_events from public,anon,authenticated,service_role;
create trigger daily_autofill_events_immutable before update or delete on public.zysyr_daily_autofill_events
 for each row execute function zysyr_daily_electronic_private.protect_daily_electronic_evidence();

-- Operational cursor, not evidence or a financial record. Unexpected draft
-- failures are durable and MUST NOT roll back a valid shared source snapshot.
create table public.zysyr_daily_autofill_status (
 shop_name text not null, business_date date not null, snapshot_id uuid not null,
 result jsonb not null, updated_at timestamptz not null default now(),
 primary key(shop_name,business_date),
 foreign key(shop_name,business_date,snapshot_id)
  references public.mgj_business_detail_snapshots(shop_name,business_date,id)
);
alter table public.zysyr_daily_autofill_status enable row level security;
alter table public.zysyr_daily_autofill_status force row level security;
create index daily_autofill_status_source_idx on public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id);
revoke all on public.zysyr_daily_autofill_status from public,anon,authenticated,service_role;

-- Pure source projection. Unknowns stay NULL; source performance is NOT price.
create function zysyr_daily_electronic_private.autofill_cells(p_source jsonb)
returns jsonb language sql immutable set search_path='' as $$
with bills as (select b from jsonb_array_elements(p_source->'bills') b),
lines as (
 select a->>'employee_id' employee_id,a->>'employee_name' employee_name,a->>'source_role' role,
  (a->>'performance_cents')::numeric/100 performance,
  (a->>'source_project_count')::numeric project_count,
  i->>'item_name' item_name,
  case when i->>'item_name' ~ '烫' and i->>'item_name' !~ '染|护理|护发|酸护|发膜' then 'perm'
   when i->>'item_name' ~ '染' and i->>'item_name' !~ '烫|护理|护发|酸护|发膜' then 'color'
   when i->>'item_name' ~ '护理|护发|酸护|发膜' and i->>'item_name' !~ '烫|染' then 'treatment'
   when i->>'item_name' ~ '^(洗发|洗头|洗吹|剪发|吹风)' then 'wash_cut_blow'
   else null end category,
  case when platform.positive_count=1 and platform.known and platform.platform_code is not null then platform.platform_code
   when platform.platform_positive then null
   when i->>'item_name' ~ '^(洗吹|吹风|造型)' then 'makeup_styling'
   when i->>'item_name' ~ '烫' and i->>'item_name' !~ '染|护理|护发|酸护|发膜' then 'perm'
   when i->>'item_name' ~ '染' and i->>'item_name' !~ '烫|护理|护发|酸护|发膜' then 'color'
   when i->>'item_name' ~ '护理|护发|酸护|发膜' and i->>'item_name' !~ '烫|染' then 'treatment'
   when i->>'item_name' ~ '^(洗发|洗头|剪发)' then 'wash_cut_blow'
   else null end stylist_category
 from bills cross join lateral jsonb_array_elements(b->'employee_allocations') a
 left join lateral (select x from jsonb_array_elements(b->'items')x
   where x->>'source_item_id'=a->>'source_item_id') item on true
 cross join lateral (select item.x i) named
 cross join lateral (select count(*) filter(where (p->>'amount_cents')::numeric>0) positive_count,
   bool_and(p->>'amount_cents' is not null) known,
   bool_or((p->>'amount_cents')::numeric>0 and p->>'source_label' in('大众点评','抖音')) platform_positive,
   max(case when (p->>'amount_cents')::numeric>0 and p->>'source_field'='dianpin' and p->>'source_label'='大众点评' then 'dianping_group'
     when (p->>'amount_cents')::numeric>0 and p->>'source_label'='抖音' then 'douyin' end) platform_code
   from jsonb_array_elements(b->'payments')p) platform
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
    case when count(l.employee_id)=0 and not exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.stylist_category is null) then 0
     when count(l.performance)=count(*) and min(l.performance)>=0 then sum(l.performance) end
   when r.section='technician' then
    case when c.code='subtotal' and exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.category is null) then null
     when count(l.employee_id)=0 and not exists(select 1 from lines u where u.employee_id=r.employee_id and u.role=r.role and u.category is null) then 0
     when count(l.project_count)=count(*) and min(l.project_count)>=0
      and bool_and(l.project_count=trunc(l.project_count)) then sum(l.project_count) end end value
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
 ('wechat','微信','weixin',7),('group_buy','团购','dianpin',9)) t(code,label,source_field,col)
), pay_cells as (
 select 'payment' section,'payment' row_key,'支付' row_label,c.code,c.label,33 row_no,c.col col_no,
  'payment_method' cell_role,
  case when count(p->>'amount_cents')=(select count(*) from bills) and min((p->>'amount_cents')::numeric)>=0
   and bool_and(c.source_field='cash' or p->>'source_label'=case c.source_field
     when 'pay' then '支付宝' when 'weixin' then '微信' when 'dianpin' then '大众点评' end)
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

create function public.mgj_autofill_daily_sheet(p_shop text,p_day date)
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
 if sid=(select e.snapshot_id from public.zysyr_daily_autofill_events e where e.draft_id=draft.id order by e.revision desc limit 1)
 then return jsonb_build_object('status','already_applied','draft_id',draft.id,'automatic_posting_enabled',false); end if;
 cells:=zysyr_daily_electronic_private.autofill_cells(source);
 if jsonb_array_length(cells)>1000 or exists(select 1 from jsonb_array_elements(cells)x
  where (x->>'row_number')::int>120 or length(x->>'row_label')>120)
 then return jsonb_build_object('status','source_too_large','automatic_posting_enabled',false); end if;
 select coalesce(jsonb_agg(distinct g),'[]'::jsonb) into gaps from jsonb_array_elements(source->'bills')b
  cross join lateral jsonb_array_elements(b->'gaps')g;
 gaps:=gaps||'["financial_review_required","full_business_totals_not_filled","platform_performance_mapping_pending","new_old_customer_counts_unknown"]'::jsonb;
 if exists(select 1 from jsonb_array_elements(source->'bills')b cross join lateral jsonb_array_elements(b->'items')i
  where i->>'item_name' !~ '烫|染|护理|护发|酸护|发膜|^(洗发|洗头|洗吹|剪发|吹风)')
 then gaps:=gaps||'["unclassified_projects"]'::jsonb; end if;
 if draft.id is null then
  insert into public.zysyr_daily_sheet_drafts(company_id,store_id,report_date,source_voucher_id,source_sha256,
   ocr_provider,ocr_model,ocr_raw_result,created_by_user_id,updated_by_user_id)
  values(company,store,p_day,null,null,'frontdesk-autofill','frontdesk-autofill-v1','{}',null,null) returning * into draft;
  is_new:=true;
 end if;
 before_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id),'created',is_new);
 -- Authorized on 2026-09-28: update unposted drafts, including manual/image
 -- drafts. Keep cell IDs, change-history FKs, vouchers and attachments intact.
 -- Previous numeric staff candidates cannot be mixed with source employee rows.
 -- Exact pre-images remain in the immutable audit; never turn old money into counts.
 if draft.ocr_model<>'frontdesk-autofill-v1' then
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
 update public.zysyr_daily_sheet_drafts d set ocr_model='frontdesk-autofill-v1',template_code='zysyr_frontdesk_project_draft',
  ocr_raw_result=d.ocr_raw_result||jsonb_build_object('autofill',jsonb_build_object('snapshot_id',sid,
   'source_sha256',source->>'source_sha256','mapping_version','frontdesk-autofill-v1','gaps',gaps,
   'source_scope','project_consumption','automatic_posting_enabled',false,
   'active_staff_row_keys',(select coalesce(jsonb_agg(distinct x->>'row_key'),'[]'::jsonb)
    from jsonb_array_elements(cells)x where x->>'section_code' in('stylist','technician')))),
  edit_revision=d.edit_revision+1,updated_by_user_id=null,updated_at=now(),
  validation_result=jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,
   'autofill_source_snapshot_id',sid,'autofill_source_sha256',source->>'source_sha256','automatic_posting_enabled',false)
 where d.id=draft.id returning * into draft;
 after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id));
 insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
 values(company,store,draft.id,sid,'frontdesk-autofill-v1',draft.edit_revision,before_data,after_data,gaps);
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

-- Database-only, same transaction as a verified source-head advance. No MGJ calls.
create function zysyr_daily_electronic_private.autofill_business_head()
returns trigger language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 begin
  result:=public.mgj_autofill_daily_sheet(new.shop_name,new.business_date);
 exception when others then
  result:=jsonb_build_object('status','failed','error_code',sqlstate,'automatic_posting_enabled',false);
 end;
 insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
 values(new.shop_name,new.business_date,new.snapshot_id,result)
 on conflict(shop_name,business_date) do update set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
 return new;
end $$;
revoke all on function zysyr_daily_electronic_private.autofill_business_head() from public,anon,authenticated,service_role;
create trigger daily_autofill_on_business_head after insert or update on public.mgj_business_detail_heads
 for each row execute function zysyr_daily_electronic_private.autofill_business_head();
