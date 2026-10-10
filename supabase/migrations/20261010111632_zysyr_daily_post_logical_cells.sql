-- Definition-only: preserve every draft, manual value, source and ledger.
set statement_timeout='30s';
set lock_timeout='5s';
create or replace function zysyr_private.daily_sheet_archive_coordinates(p_company uuid,p_store uuid,p_draft uuid)
returns table(cell_id uuid,archive_row integer,archive_column integer,archive_address text)
language sql stable security definer set search_path='' as $$
 with cells as (select * from public.zysyr_daily_sheet_cells where company_id=p_company and store_id=p_store and draft_id=p_draft),
 rows as (select section_code,row_key,dense_rank() over(partition by section_code order by min(row_number),row_key)::integer as n from cells group by section_code,row_key),
 cols as (select section_code,column_code,dense_rank() over(partition by section_code order by min(column_number),column_code)::integer as n from cells group by section_code,column_code)
 select c.id,r.n,k.n,zysyr_private.sheet_column_name(k.n)||r.n::text from cells c
 join rows r using(section_code,row_key) join cols k using(section_code,column_code)
$$;
revoke all on function zysyr_private.daily_sheet_archive_coordinates(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Apply only the reviewed archival projection, leaving finance guards intact.
do $$ declare definition text; old text; replacement text; begin
 definition:=pg_get_functiondef('public.zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)'::regprocedure);
 if position('daily_sheet_archive_coordinates' in definition)>0 then return; end if;
 old:=$old$'cell_address', zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text,
    'row_number', cell.row_number,
    'column_number', cell.column_number,$old$;
 replacement:=$new$'cell_address', archive.archive_address,
    'row_number', archive.archive_row,
    'column_number', archive.archive_column,$new$;
 if position(old in definition)=0 then raise exception 'DAILY_ARCHIVE_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell$old$;
 replacement:=$new$) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell
  join zysyr_private.daily_sheet_archive_coordinates(p_company_id,p_store_id,p_draft_id) archive on archive.cell_id=cell.id$new$;
 if position(old in definition)=0 then raise exception 'DAILY_ARCHIVE_REGISTRATION_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text as cell_address
    from public.zysyr_daily_sheet_cells cell$old$;
 replacement:=$new$archive.archive_address as cell_address
    from public.zysyr_daily_sheet_cells cell
    join zysyr_private.daily_sheet_archive_coordinates(p_company_id,p_store_id,p_draft_id) archive on archive.cell_id=cell.id$new$;
 if position(old in definition)=0 then raise exception 'DAILY_ARCHIVE_LINEAGE_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $$;

-- The one explicit final confirmation records the receipt attestation and posts
-- in the same transaction. Any posting failure rolls back the new proof/audit.
create or replace function public.zysyr_confirm_daily_sheet_reviewed(
 p_actor_user_id uuid,p_actor_auth_user_id uuid,p_company_id uuid,p_store_id uuid,p_draft_id uuid,
 p_report jsonb,p_is_business_day boolean,p_reason text,p_expected_revision integer,
 p_cash_source_token text,p_cash_request_id uuid,p_cash_statement text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
 if zysyr_private.request_role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='DAILY_CASH_REVIEW_SERVICE_ONLY'; end if;
 if p_cash_source_token is not null then
  if p_cash_statement is distinct from 'cash-original-channels-sales-v1' then
   raise exception using errcode='22023',message='DAILY_CASH_REVIEW_EXPLICIT_CONFIRMATION_REQUIRED'; end if;
  perform public.zysyr_review_daily_cash_sources(p_actor_user_id,p_actor_auth_user_id,p_company_id,p_store_id,
   p_draft_id,p_expected_revision,p_cash_source_token,p_cash_request_id,true,true,true,p_reason);
 end if;
 return public.zysyr_confirm_daily_sheet(p_actor_user_id,p_company_id,p_store_id,p_draft_id,p_report,p_is_business_day,p_reason,p_expected_revision);
end $$;
revoke all on function public.zysyr_confirm_daily_sheet_reviewed(uuid,uuid,uuid,uuid,uuid,jsonb,boolean,text,integer,text,uuid,text) from public,anon,authenticated;
grant execute on function public.zysyr_confirm_daily_sheet_reviewed(uuid,uuid,uuid,uuid,uuid,jsonb,boolean,text,integer,text,uuid,text) to service_role;
