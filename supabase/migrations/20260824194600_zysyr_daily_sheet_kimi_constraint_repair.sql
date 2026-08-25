begin;

alter table public.zysyr_daily_sheet_cells
  drop constraint if exists zysyr_daily_sheet_cells_source_method_check;

alter table public.zysyr_daily_sheet_cells
  add constraint zysyr_daily_sheet_cells_source_method_check
  check (source_method in ('openai_vision', 'kimi_vision', 'paddle_ocr', 'blank_template'));

do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid)
    into v_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.zysyr_daily_sheet_cells'::regclass
    and constraint_row.conname = 'zysyr_daily_sheet_cells_source_method_check';

  if v_definition is null or position('kimi_vision' in v_definition) = 0 then
    raise exception using errcode = '23514', message = 'KIMI_SOURCE_METHOD_CONSTRAINT_NOT_APPLIED';
  end if;
end
$$;

commit;
