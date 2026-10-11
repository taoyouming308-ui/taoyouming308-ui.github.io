-- Read tightening only. Audit rows, writes, triggers, owner/RLS and broker service privileges are preserved.
begin;
revoke select on table public.zysyr_daily_sheet_cell_changes from public, anon, authenticated;
commit;
