begin;

alter table public.zysyr_daily_sheet_cells
  drop constraint if exists zysyr_daily_sheet_cells_source_method_check;

alter table public.zysyr_daily_sheet_cells
  add constraint zysyr_daily_sheet_cells_source_method_check
  check (source_method in ('openai_vision', 'kimi_vision', 'paddle_ocr', 'blank_template'));

commit;
