-- Record locally authenticated Codex CLI recognition separately from direct
-- OpenAI API calls. Historical OpenAI/Kimi candidate labels remain readable.
alter table public.zysyr_daily_sheet_cells
  drop constraint if exists zysyr_daily_sheet_cells_source_method_check;
alter table public.zysyr_daily_sheet_cells
  add constraint zysyr_daily_sheet_cells_source_method_check check (
    source_method in (
      'openai_vision','openai_vision_candidate','codex_local_candidate',
      'kimi_vision','kimi_vision_candidate','paddle_ocr','blank_template'
    )
  );

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.zysyr_apply_daily_sheet_recognition_candidates(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text)'::regprocedure
  ) into v_definition;
  if position('openai_vision_candidate' in v_definition) = 0
    or position('ocr_provider=''openai''' in v_definition) = 0 then
    raise exception 'EXPECTED_OPENAI_DAILY_CANDIDATE_FUNCTION_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, 'openai_vision_candidate', 'codex_local_candidate');
  v_definition := replace(v_definition, 'ocr_provider=''openai''', 'ocr_provider=''codex-local''');
  v_definition := replace(v_definition, '''provider'', ''openai''', '''provider'', ''codex-local''');
  v_definition := replace(
    v_definition,
    'OpenAI原图识别候选已保存，等待财务逐格核对并最终确认',
    '本机Codex原图识别候选已保存，等待财务逐格核对并最终确认'
  );
  execute v_definition;
end $$;
