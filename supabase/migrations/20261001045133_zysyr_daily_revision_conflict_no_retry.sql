-- Production migration version: 20261001045401 (MCP applied this exact body).
-- A stale browser revision is a permanent business conflict, not a database
-- serialization failure. PostgREST can retry 40001 indefinitely, even after
-- the calling Edge request times out. PT409 returns the conflict immediately.
-- Change only the two public revision guards; preserve their complete bodies,
-- ownership, grants, locks, scope checks and calls to atomic implementations.
-- No table, financial value, historical report or audit row is modified.
do $migration$
declare
  v_signature text;
  v_definition text;
  v_old constant text := 'errcode = ''40001'', message = ''DAILY_SHEET_REVISION_CONFLICT''';
  v_new constant text := 'errcode = ''PT409'', message = ''DAILY_SHEET_REVISION_CONFLICT''';
begin
  foreach v_signature in array array[
    'public.zysyr_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text,integer)',
    'public.zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text,integer)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position(v_new in v_definition) > 0 and position(v_old in v_definition) = 0 then
      continue;
    end if;
    if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Unexpected daily revision guard definition: %', v_signature;
    end if;
    execute replace(v_definition, v_old, v_new);
  end loop;
end
$migration$;
