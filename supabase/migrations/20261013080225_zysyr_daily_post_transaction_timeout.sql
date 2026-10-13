-- The atomic review/archive/post transaction frequently approaches the API's
-- default 8-second limit. Give ONLY this RPC a bounded 30-second budget.
-- No body, role, ACL, lock timeout, formula, cell or historical row changes.
alter function public.zysyr_confirm_daily_project_review(uuid,uuid,uuid,uuid,uuid,integer,jsonb,boolean,text,jsonb,jsonb,text)
  set statement_timeout = '30s';
notify pgrst, 'reload schema';

-- Rollback: ALTER FUNCTION with the same signature RESET statement_timeout;
-- then NOTIFY pgrst, 'reload schema'. The existing lock_timeout stays 5s.
