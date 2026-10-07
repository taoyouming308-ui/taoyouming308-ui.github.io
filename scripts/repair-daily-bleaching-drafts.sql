-- Explicit, separate repair; never run as part of migration installation.
-- Caller MUST supply zysyr.bleaching_repair_dates as a JSON array of approved dates.
-- Fixed company + Xiangli scope. Unposted source drafts only. No source collection or posting.
do $repair$
declare
  company constant uuid := '02463a53-dfdb-4291-b04d-dd1d85f9d998';
  store constant uuid := '8d057980-ff8f-4b2c-9c7f-4dd23a568f35';
  day date;
  draft public.zysyr_daily_sheet_drafts;
  head public.mgj_business_detail_heads;
  snapshot public.mgj_business_detail_snapshots;
  live_list jsonb;
  source jsonb;
  old_source jsonb;
  new_cells jsonb;
  old_cells jsonb;
  changed_cells jsonb;
  old_issues jsonb;
  new_issues jsonb;
  gaps jsonb;
  before_data jsonb;
  after_data jsonb;
  item jsonb;
  n integer;
begin
  if nullif(current_setting('zysyr.bleaching_repair_dates',true),'') is null then
    raise exception 'BLEACHING_REPAIR_DATES_REQUIRED';
  end if;
  for day in select value::date from jsonb_array_elements_text(current_setting('zysyr.bleaching_repair_dates')::jsonb) loop
    if day < date '2026-01-01' or day > (now() at time zone 'Asia/Shanghai')::date then
      raise exception 'BLEACHING_REPAIR_DATE_INVALID';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('daily_autofill:'||store||':'||day,0));
    if zysyr_private.period_is_locked(company,store,day)
      or exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store and d.report_date=day and d.status='confirmed')
    then continue; end if;
    if (select count(*) from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store and d.report_date=day and d.status='draft')<>1
    then continue; end if;
    select * into draft from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store and d.report_date=day and d.status='draft' for update;
    if draft.ocr_model<>'frontdesk-autofill-v2' or zysyr_private.period_is_locked(company,store,day)
      or exists(select 1 from public.zysyr_daily_sheet_drafts d where d.company_id=company and d.store_id=store and d.report_date=day and d.status='confirmed')
    then continue; end if;
    -- Fail closed even for human changes outside this repair, rather than recompute a mixed draft.
    if exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override) then continue; end if;
    old_issues:=draft.ocr_raw_result#>'{autofill,classification_issues}';
    if old_issues is null or jsonb_array_length(old_issues)=0 then continue; end if;
    if exists(select 1 from jsonb_array_elements(old_issues)x where x->>'reason'<>'project_unmapped' or x->>'project_name' !~ '^漂发([0-9]+(元)?)?$')
    then raise exception 'BLEACHING_REPAIR_OTHER_ISSUES'; end if;
    select * into head from public.mgj_business_detail_heads h where h.shop_name='向里造型' and h.business_date=day for share;
    if head.snapshot_id is distinct from (draft.ocr_raw_result#>>'{autofill,snapshot_id}')::uuid then raise exception 'BLEACHING_REPAIR_SOURCE_CHANGED'; end if;
    select * into snapshot from public.mgj_business_detail_snapshots s where s.id=head.snapshot_id and s.shop_name='向里造型' and s.business_date=day;
    select services into live_list from public.mgj_daily_consumption where shop_name='向里造型' and business_date=day for share;
    source:=snapshot.payload;
    if source is null or source->>'shop_id'<>'1837032' or source->>'business_date'<>day::text or live_list is null
      or (select array_agg(x->>'source_bill_id' order by x->>'source_bill_id') from jsonb_array_elements(source->'bills')x)
        is distinct from (select array_agg(x->>'source_id' order by x->>'source_id') from jsonb_array_elements(live_list)x)
      or exists(select 1 from jsonb_array_elements(source->'bills')b join jsonb_array_elements(live_list)x on x->>'source_id'=b->>'source_bill_id'
        where (b->>'source_posted_amount_cents')::numeric is distinct from (x->>'amount')::numeric*100)
    then raise exception 'BLEACHING_REPAIR_SOURCE_UNVERIFIED'; end if;
    -- Reconstruct ONLY the formerly-unmapped names, in memory; immutable evidence stays untouched.
    old_source:=jsonb_set(source,'{bills}',(select jsonb_agg(jsonb_set(b,'{items}',
      (select jsonb_agg(case when exists(select 1 from jsonb_array_elements(old_issues)i
          where i->>'bill_id'=b->>'source_bill_id' and i->>'project_code'=x->>'item_code' and i->>'project_name'=x->>'item_name')
        then jsonb_set(x,'{item_name}','"__bleaching_pre_fix_unmapped__"'::jsonb) else x end order by xi)
       from jsonb_array_elements(b->'items') with ordinality it(x,xi))) order by bi)
      from jsonb_array_elements(source->'bills') with ordinality bills(b,bi)));
    old_cells:=zysyr_daily_electronic_private.autofill_cells(old_source);
    new_cells:=zysyr_daily_electronic_private.autofill_cells(source);
    new_issues:=zysyr_daily_electronic_private.project_classification_issues(source);
    if jsonb_array_length(new_issues)<>0 then raise exception 'BLEACHING_REPAIR_STILL_UNRESOLVED'; end if;
    select coalesce(jsonb_agg(x),'[]'::jsonb) into changed_cells from jsonb_array_elements(new_cells)x
      join jsonb_array_elements(old_cells)o on o->>'section_code'=x->>'section_code' and o->>'row_key'=x->>'row_key' and o->>'column_code'=x->>'column_code'
      where x->>'section_code' in('stylist','technician') and x->'value' is distinct from o->'value';
    if jsonb_array_length(changed_cells)=0 then raise exception 'BLEACHING_REPAIR_NO_DERIVED_CHANGE'; end if;
    if exists(select 1 from jsonb_array_elements(changed_cells)x where x->>'section_code'='stylist' and x->>'column_code'='subtotal')
    then raise exception 'BLEACHING_REPAIR_TOTAL_CHANGED'; end if;
    -- The draft must still equal the old projection for every proposed replacement.
    for item in select value from jsonb_array_elements(changed_cells) loop
      if not exists(select 1 from public.zysyr_daily_sheet_cells c join jsonb_array_elements(old_cells)o
        on o->>'section_code'=c.section_code and o->>'row_key'=c.row_key and o->>'column_code'=c.column_code
        where c.draft_id=draft.id and c.section_code=item->>'section_code' and c.row_key=item->>'row_key' and c.column_code=item->>'column_code'
          and c.company_id=company and c.store_id=store and c.source_method='frontdesk_autofill' and not c.manual_override
          and c.ocr_numeric is not distinct from (o->>'value')::numeric)
      then raise exception 'BLEACHING_REPAIR_CELL_DIVERGED'; end if;
    end loop;
    before_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id),'repair','bleaching-color-2026-10-07');
    update public.zysyr_daily_sheet_cells c set ocr_numeric=(x->>'value')::numeric,ocr_text=x->>'value',updated_at=now()
      from jsonb_array_elements(changed_cells)x where c.draft_id=draft.id and c.section_code=x->>'section_code' and c.row_key=x->>'row_key' and c.column_code=x->>'column_code' and not c.manual_override;
    get diagnostics n=row_count;
    if n<>jsonb_array_length(changed_cells) then raise exception 'BLEACHING_REPAIR_WRITE_COUNT'; end if;
    gaps:=coalesce(draft.ocr_raw_result#>'{autofill,gaps}','[]'::jsonb);
    select coalesce(jsonb_agg(g),'[]'::jsonb) into gaps from jsonb_array_elements(gaps)g where g<>'"project_or_platform_assignment_unresolved"'::jsonb;
    update public.zysyr_daily_sheet_drafts d set
      ocr_raw_result=jsonb_set(jsonb_set(d.ocr_raw_result,'{autofill,classification_issues}',new_issues),'{autofill,gaps}',gaps),
      validation_result=d.validation_result||jsonb_build_object('valid',false,'needs_finance_review',true,'autofill_gaps',gaps,'automatic_posting_enabled',false),
      edit_revision=d.edit_revision+1,updated_at=now()
      where d.id=draft.id and d.status='draft' and d.edit_revision=draft.edit_revision returning * into draft;
    if not found then raise exception 'BLEACHING_REPAIR_REVISION_CONFLICT'; end if;
    after_data:=jsonb_build_object('draft',to_jsonb(draft),'cells',(select jsonb_agg(to_jsonb(c) order by c.id) from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id),'repair','bleaching-color-2026-10-07');
    if (select jsonb_agg(c order by c->>'id') from jsonb_array_elements(before_data->'cells')c where c->>'section_code' not in('stylist','technician'))
      is distinct from (select jsonb_agg(c order by c->>'id') from jsonb_array_elements(after_data->'cells')c where c->>'section_code' not in('stylist','technician'))
    then raise exception 'BLEACHING_REPAIR_PROTECTED_CELLS_CHANGED'; end if;
    insert into public.zysyr_daily_autofill_events(company_id,store_id,draft_id,snapshot_id,mapping_version,revision,before_snapshot,after_snapshot,review_gaps)
      values(company,store,draft.id,snapshot.id,'frontdesk-autofill-v10',draft.edit_revision,before_data,after_data,gaps);
  end loop;
end $repair$;
