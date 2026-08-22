-- ZYSYR V2 Sprint 7: immutable photo-report import batches, explicit conflicts,
-- and source-to-business reconciliation.
set statement_timeout='30s';
set lock_timeout='5s';

alter table public.zysyr_report_uploads drop constraint if exists zysyr_report_uploads_mime_type_check;
alter table public.zysyr_report_uploads add constraint zysyr_report_uploads_mime_type_check check(mime_type in (
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'
));

create table public.zysyr_import_batches(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,import_type text not null check(import_type in ('daily_photo','performance_photo','payroll_photo','inventory_photo')),
  report_date date not null,source_voucher_id uuid not null,source_report_id uuid,status text not null default 'validated'
    check(status in ('validated','conflict','importing','reconciled','failed','cancelled')),
  raw_row_count integer not null check(raw_row_count between 1 and 1000),mapped_row_count integer not null default 0 check(mapped_row_count between 0 and 1000),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),reason text not null check(nullif(btrim(reason),'') is not null),
  created_by_user_id uuid not null,created_at timestamptz not null default now(),completed_at timestamptz,error_message text,
  unique(company_id,id),unique(company_id,store_id,id),
  foreign key(company_id,store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,source_voucher_id) references public.zysyr_voucher_attachments(company_id,id) on delete restrict,
  foreign key(company_id,store_id,source_report_id) references public.zysyr_report_uploads(company_id,store_id,id) on delete restrict,
  foreign key(company_id,created_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict
);
create table public.zysyr_import_rows(
  id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,import_batch_id uuid not null,
  row_number integer not null check(row_number>0),raw_json jsonb not null check(jsonb_typeof(raw_json)='object'),
  mapped_json jsonb not null check(jsonb_typeof(mapped_json)='object'),validation_status text not null check(validation_status in ('valid','warning','invalid')),
  validation_errors jsonb not null default '[]'::jsonb check(jsonb_typeof(validation_errors)='array'),source_report_cell_id uuid,business_type text,business_id uuid,
  created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,store_id,id),unique(company_id,import_batch_id,row_number),
  foreign key(company_id,store_id,import_batch_id) references public.zysyr_import_batches(company_id,store_id,id) on delete restrict,
  foreign key(company_id,store_id,source_report_cell_id) references public.zysyr_report_cells(company_id,store_id,id) on delete restrict
);
create table public.zysyr_import_conflicts(
  id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,import_batch_id uuid not null,
  conflict_type text not null check(conflict_type in ('existing_daily_report','duplicate_source','row_validation','amount_mismatch')),
  existing_entity_type text,existing_entity_id uuid,details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  resolution_status text not null default 'open' check(resolution_status in ('open','resolved','ignored')),created_at timestamptz not null default now(),
  unique(company_id,id),foreign key(company_id,store_id,import_batch_id) references public.zysyr_import_batches(company_id,store_id,id) on delete restrict
);
create table public.zysyr_reconciliation_reports(
  id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,import_batch_id uuid not null,daily_report_id uuid,
  status text not null check(status in ('matched','mismatch','incomplete')),source_row_count integer not null,business_row_count integer not null,
  source_amount numeric(14,2) not null,business_amount numeric(14,2) not null,delta numeric(14,2) not null,
  generated_by_user_id uuid not null,generated_at timestamptz not null default now(),unique(company_id,id),unique(company_id,store_id,id),unique(company_id,import_batch_id),
  foreign key(company_id,store_id,import_batch_id) references public.zysyr_import_batches(company_id,store_id,id) on delete restrict,
  foreign key(company_id,store_id,daily_report_id) references public.zysyr_daily_reports(company_id,store_id,id) on delete restrict,
  foreign key(company_id,generated_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict
);
create table public.zysyr_reconciliation_lines(
  id uuid primary key default gen_random_uuid(),company_id uuid not null,store_id uuid not null,reconciliation_report_id uuid not null,import_row_id uuid not null,
  business_type text,business_id uuid,source_amount numeric(14,2),business_amount numeric(14,2),delta numeric(14,2),
  status text not null check(status in ('matched','mismatch','missing')),details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,reconciliation_report_id,import_row_id),
  foreign key(company_id,store_id,reconciliation_report_id) references public.zysyr_reconciliation_reports(company_id,store_id,id) on delete restrict,
  foreign key(company_id,store_id,import_row_id) references public.zysyr_import_rows(company_id,store_id,id) on delete restrict
);
create index zysyr_import_batches_scope_idx on public.zysyr_import_batches(company_id,store_id,report_date desc,created_at desc);
create index zysyr_import_rows_batch_idx on public.zysyr_import_rows(company_id,import_batch_id,row_number);
create index zysyr_import_conflicts_open_idx on public.zysyr_import_conflicts(company_id,store_id,created_at desc) where resolution_status='open';

create or replace function public.zysyr_create_photo_import_batch(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_report_date date,p_source_voucher_id uuid,p_rows jsonb,p_reason text
) returns public.zysyr_import_batches language plpgsql security definer set search_path='' as $$
declare v_saved public.zysyr_import_batches; v_row jsonb; v_number integer:=0; v_errors jsonb; v_status text; v_existing uuid;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  if p_report_date is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='IMPORT_BATCH_INPUT_INVALID'; end if;
  if zysyr_private.period_is_locked(p_company_id,p_store_id,p_report_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  if not exists(select 1 from public.zysyr_voucher_attachments voucher where voucher.company_id=p_company_id and voucher.store_id=p_store_id
    and voucher.id=p_source_voucher_id and voucher.audit_status='approved' and voucher.document_type='daily_report') then
    raise exception using errcode='P0002',message='APPROVED_DAILY_VOUCHER_REQUIRED'; end if;
  select report.id into v_existing from public.zysyr_daily_reports report where report.company_id=p_company_id and report.store_id=p_store_id
    and report.report_date=p_report_date and report.status in ('submitted','approved') order by report.version desc limit 1;
  insert into public.zysyr_import_batches(company_id,store_id,import_type,report_date,source_voucher_id,status,raw_row_count,payload_sha256,reason,created_by_user_id)
  values(p_company_id,p_store_id,'daily_photo',p_report_date,p_source_voucher_id,case when v_existing is null then 'validated' else 'conflict' end,
    jsonb_array_length(p_rows),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_rows::text,'UTF8')),'hex'),btrim(p_reason),p_actor_user_id) returning * into v_saved;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_number:=v_number+1; v_errors:='[]'::jsonb;
    if jsonb_typeof(v_row)<>'object' or coalesce(v_row->>'line_type','') not in ('income','expense','petty_cash','payment','note') then v_errors:=v_errors||'["line_type"]'::jsonb; end if;
    if coalesce(v_row->>'metric_code','')!~'^[A-Z][A-Z0-9_]{1,63}$' then v_errors:=v_errors||'["metric_code"]'::jsonb; end if;
    if nullif(btrim(v_row->>'description'),'') is null then v_errors:=v_errors||'["description"]'::jsonb; end if;
    if coalesce(v_row->>'line_type','')<>'note' and (v_row->>'amount' is null or (v_row->>'amount')::numeric<0) then v_errors:=v_errors||'["amount"]'::jsonb; end if;
    v_status:=case when jsonb_array_length(v_errors)=0 then 'valid' else 'invalid' end;
    insert into public.zysyr_import_rows(company_id,store_id,import_batch_id,row_number,raw_json,mapped_json,validation_status,validation_errors)
    values(p_company_id,p_store_id,v_saved.id,v_number,v_row,v_row,v_status,v_errors);
  end loop;
  update public.zysyr_import_batches set mapped_row_count=(select count(*) from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='valid')
    where id=v_saved.id returning * into v_saved;
  if exists(select 1 from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='invalid') then
    update public.zysyr_import_batches set status='conflict' where id=v_saved.id returning * into v_saved;
    insert into public.zysyr_import_conflicts(company_id,store_id,import_batch_id,conflict_type,details)
    values(p_company_id,p_store_id,v_saved.id,'row_validation',jsonb_build_object('invalid_rows',(select jsonb_agg(row.row_number) from public.zysyr_import_rows row where row.import_batch_id=v_saved.id and row.validation_status='invalid')));
  end if;
  if v_existing is not null then insert into public.zysyr_import_conflicts(company_id,store_id,import_batch_id,conflict_type,existing_entity_type,existing_entity_id,details)
    values(p_company_id,p_store_id,v_saved.id,'existing_daily_report','daily_report',v_existing,jsonb_build_object('rule','先冲销现有日报，再新建导入批次；系统不覆盖。')); end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'import','import_batch',v_saved.id,'validate',jsonb_build_object('status',v_saved.status,'row_count',v_saved.raw_row_count,'payload_sha256',v_saved.payload_sha256),btrim(p_reason),'financial');
  return v_saved;
end $$;

create or replace function public.zysyr_attach_import_report(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_import_batch_id uuid,p_source_report_id uuid
) returns public.zysyr_import_batches language plpgsql security definer set search_path='' as $$
declare v_batch public.zysyr_import_batches; v_cells uuid[]; v_index integer:=0;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_batch from public.zysyr_import_batches batch where batch.company_id=p_company_id and batch.store_id=p_store_id and batch.id=p_import_batch_id for update;
  if not found or v_batch.status<>'validated' then raise exception using errcode='55000',message='IMPORT_BATCH_NOT_VALIDATED'; end if;
  if not exists(select 1 from public.zysyr_report_uploads report where report.company_id=p_company_id and report.store_id=p_store_id and report.id=p_source_report_id
    and report.report_type='daily' and report.report_date=v_batch.report_date and report.status='active') then raise exception using errcode='P0002',message='IMPORT_REPORT_NOT_FOUND'; end if;
  select array_agg(cell.id order by cell.row_number) into v_cells from public.zysyr_report_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id
    and cell.report_id=p_source_report_id and cell.cell_kind='input' and cell.numeric_value is not null;
  if cardinality(v_cells)<>(select count(*) from public.zysyr_import_rows row where row.import_batch_id=v_batch.id and row.mapped_json->>'line_type'<>'note') then
    raise exception using errcode='22023',message='IMPORT_REPORT_CELL_COUNT_MISMATCH'; end if;
  for v_index in 1..cardinality(v_cells) loop update public.zysyr_import_rows row set source_report_cell_id=v_cells[v_index]
    where row.id=(select target.id from public.zysyr_import_rows target where target.import_batch_id=v_batch.id and target.mapped_json->>'line_type'<>'note' order by target.row_number offset v_index-1 limit 1); end loop;
  insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
  values(p_company_id,p_store_id,v_batch.source_voucher_id,'report_upload',p_source_report_id,'source_document',p_actor_user_id)
  on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  update public.zysyr_import_batches set source_report_id=p_source_report_id,status='importing' where id=v_batch.id returning * into v_batch; return v_batch;
end $$;

create or replace function public.zysyr_finalize_daily_import(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_import_batch_id uuid,p_daily_report_id uuid
) returns public.zysyr_reconciliation_reports language plpgsql security definer set search_path='' as $$
declare v_batch public.zysyr_import_batches; v_report public.zysyr_daily_reports; v_recon public.zysyr_reconciliation_reports;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'daily_report.write');
  select * into v_batch from public.zysyr_import_batches batch where batch.company_id=p_company_id and batch.store_id=p_store_id and batch.id=p_import_batch_id and batch.status='importing' for update;
  if not found then raise exception using errcode='55000',message='IMPORT_BATCH_NOT_IMPORTING'; end if;
  select * into v_report from public.zysyr_daily_reports report where report.company_id=p_company_id and report.store_id=p_store_id and report.id=p_daily_report_id and report.source_report_id=v_batch.source_report_id;
  if not found then raise exception using errcode='P0002',message='IMPORTED_DAILY_REPORT_NOT_FOUND'; end if;
  update public.zysyr_import_rows row set business_type='daily_report_line',business_id=line.id
  from public.zysyr_daily_report_lines line where row.import_batch_id=v_batch.id and line.daily_report_id=v_report.id and line.line_number=row.row_number;
  insert into public.zysyr_reconciliation_reports(company_id,store_id,import_batch_id,daily_report_id,status,source_row_count,business_row_count,source_amount,business_amount,delta,generated_by_user_id)
  select p_company_id,p_store_id,v_batch.id,v_report.id,
    case when count(row.id)=count(line.id) and coalesce(sum((row.mapped_json->>'amount')::numeric),0)=coalesce(sum(line.amount),0) then 'matched' else 'mismatch' end,
    count(row.id),count(line.id),coalesce(sum((row.mapped_json->>'amount')::numeric),0),coalesce(sum(line.amount),0),
    coalesce(sum(line.amount),0)-coalesce(sum((row.mapped_json->>'amount')::numeric),0),p_actor_user_id
  from public.zysyr_import_rows row left join public.zysyr_daily_report_lines line on line.company_id=p_company_id and line.daily_report_id=v_report.id and line.line_number=row.row_number
  where row.import_batch_id=v_batch.id returning * into v_recon;
  insert into public.zysyr_reconciliation_lines(company_id,store_id,reconciliation_report_id,import_row_id,business_type,business_id,source_amount,business_amount,delta,status,details)
  select p_company_id,p_store_id,v_recon.id,row.id,'daily_report_line',line.id,nullif(row.mapped_json->>'amount','')::numeric,line.amount,
    coalesce(line.amount,0)-coalesce(nullif(row.mapped_json->>'amount','')::numeric,0),case when line.id is null then 'missing' when line.amount is not distinct from nullif(row.mapped_json->>'amount','')::numeric then 'matched' else 'mismatch' end,
    jsonb_build_object('metric_code',row.mapped_json->>'metric_code','row_number',row.row_number)
  from public.zysyr_import_rows row left join public.zysyr_daily_report_lines line on line.company_id=p_company_id and line.daily_report_id=v_report.id and line.line_number=row.row_number where row.import_batch_id=v_batch.id;
  insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
  select p_company_id,p_store_id,v_batch.source_voucher_id,'daily_report',v_report.id,'source_document',p_actor_user_id
  union all select p_company_id,p_store_id,v_batch.source_voucher_id,'daily_report_line',line.id,'source_document',p_actor_user_id from public.zysyr_daily_report_lines line where line.company_id=p_company_id and line.daily_report_id=v_report.id
  on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  update public.zysyr_import_batches set status=case when v_recon.status='matched' then 'reconciled' else 'failed' end,completed_at=now(),error_message=case when v_recon.status='matched' then null else 'IMPORT_RECONCILIATION_MISMATCH' end where id=v_batch.id;
  return v_recon;
end $$;

alter function public.zysyr_review_daily_report(uuid,uuid,uuid,uuid,text,text) rename to zysyr_review_daily_report_core_v429;
create or replace function public.zysyr_review_daily_report(p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_daily_report_id uuid,p_decision text,p_reason text)
returns public.zysyr_daily_reports language plpgsql security definer set search_path='' as $$
declare v_saved public.zysyr_daily_reports;
begin
  v_saved:=public.zysyr_review_daily_report_core_v429(p_actor_user_id,p_company_id,p_store_id,p_daily_report_id,p_decision,p_reason);
  if p_decision='approved' then
    insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
    select income.company_id,income.store_id,link.voucher_id,'income_record',income.id,'source_document',p_actor_user_id
    from public.zysyr_income_records income join public.zysyr_voucher_links link on link.company_id=income.company_id and link.business_type='daily_report_line'
      and link.business_id=income.daily_report_line_id and link.unlinked_at is null where income.company_id=p_company_id and income.daily_report_id=p_daily_report_id
    on conflict(company_id,voucher_id,business_type,business_id,relation_type) where unlinked_at is null do nothing;
  end if; return v_saved;
end $$;

revoke execute on function public.zysyr_create_photo_import_batch(uuid,uuid,uuid,date,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_attach_import_report(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_finalize_daily_import(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_review_daily_report(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_create_photo_import_batch(uuid,uuid,uuid,date,uuid,jsonb,text) to service_role;
grant execute on function public.zysyr_attach_import_report(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.zysyr_finalize_daily_import(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.zysyr_review_daily_report(uuid,uuid,uuid,uuid,text,text) to service_role;

alter table public.zysyr_import_batches enable row level security; alter table public.zysyr_import_batches force row level security;
alter table public.zysyr_import_rows enable row level security; alter table public.zysyr_import_rows force row level security;
alter table public.zysyr_import_conflicts enable row level security; alter table public.zysyr_import_conflicts force row level security;
alter table public.zysyr_reconciliation_reports enable row level security; alter table public.zysyr_reconciliation_reports force row level security;
alter table public.zysyr_reconciliation_lines enable row level security; alter table public.zysyr_reconciliation_lines force row level security;
create policy zysyr_import_batches_scope_select on public.zysyr_import_batches for select to authenticated using((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_import_rows_scope_select on public.zysyr_import_rows for select to authenticated using((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_import_conflicts_scope_select on public.zysyr_import_conflicts for select to authenticated using((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_reconciliation_reports_scope_select on public.zysyr_reconciliation_reports for select to authenticated using((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_reconciliation_lines_scope_select on public.zysyr_reconciliation_lines for select to authenticated using((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
revoke all on table public.zysyr_import_batches,public.zysyr_import_rows,public.zysyr_import_conflicts,public.zysyr_reconciliation_reports,public.zysyr_reconciliation_lines from public,anon,authenticated,service_role;
grant select on table public.zysyr_import_batches,public.zysyr_import_rows,public.zysyr_import_conflicts,public.zysyr_reconciliation_reports,public.zysyr_reconciliation_lines to authenticated,service_role;
