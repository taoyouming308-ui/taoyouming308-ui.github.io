-- Gate A verification follow-up.
-- Supabase's production advisor requires the complete foreign-key columns to be
-- the leftmost index prefix. Existing scope/timeline indexes use a different
-- order and therefore do not cover these three RESTRICT checks.

set statement_timeout = '30s';

create index if not exists zysyr_user_role_grants_role_idx
  on public.zysyr_user_role_grants (role_id);

create index if not exists zysyr_user_capability_grants_capability_idx
  on public.zysyr_user_capability_grants (capability_id);

create index if not exists zysyr_period_lock_events_company_lock_idx
  on public.zysyr_period_lock_events (company_id, period_lock_id);
