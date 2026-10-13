-- Definition-only repair of correction archival coordinates and source lineage.
-- Reuse the existing normal-posting logical map; keep every cell and amount.
set lock_timeout='5s';
set statement_timeout='30s';
do $repair$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('zysyr_private.admin_correction_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)'::regprocedure);
 if position('daily_sheet_archive_coordinates' in definition)>0 then
   if position($anchor$'cell_address', archive.archive_address$anchor$ in definition)=0
     or position('archive.archive_address as cell_address' in definition)=0 then
     raise exception 'DAILY_CORRECTION_ARCHIVE_PARTIAL_BASELINE';
   end if;
   return;
 end if;
 old:=$old$'cell_address', zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text,
    'row_number', cell.row_number,
    'column_number', cell.column_number,$old$;
 replacement:=$new$'cell_address', archive.archive_address,
    'row_number', archive.archive_row,
    'column_number', archive.archive_column,$new$;
 if position(old in definition)=0 then raise exception 'DAILY_CORRECTION_ARCHIVE_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell$old$;
 replacement:=$new$) order by cell.row_number, cell.column_number) into v_report_cells
  from public.zysyr_daily_sheet_cells cell
  join zysyr_private.daily_sheet_archive_coordinates(p_company_id,p_store_id,p_draft_id) archive on archive.cell_id=cell.id$new$;
 if position(old in definition)=0 then raise exception 'DAILY_CORRECTION_ARCHIVE_REGISTRATION_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$zysyr_private.sheet_column_name(cell.column_number) || cell.row_number::text as cell_address
    from public.zysyr_daily_sheet_cells cell$old$;
 replacement:=$new$archive.archive_address as cell_address
    from public.zysyr_daily_sheet_cells cell
    join zysyr_private.daily_sheet_archive_coordinates(p_company_id,p_store_id,p_draft_id) archive on archive.cell_id=cell.id$new$;
 if position(old in definition)=0 then raise exception 'DAILY_CORRECTION_ARCHIVE_LINEAGE_BASELINE_CHANGED'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $repair$;
