-- TEST FIXTURE ONLY. Additive to the disposable Stage6/Stage7 synthetic database.
-- Not a production migration, installer, credential issuer or RLS proof.
do $$
begin
  if current_database() <> 'design_executor_synthetic'
    or current_setting('design_executor.synthetic_fixture',true) is distinct from 'offline-stage6-only'
    or current_setting('design_workflow.synthetic_fixture',true) is distinct from 'offline-stage7-only'
    or current_setting('server_version_num')::integer / 10000 <> 17
    or to_regclass('design_private.runtime_contract') is null
    or to_regclass('design_private.workflow_contract') is null
    or to_regclass('design_private.model_candidates') is not null
    or to_regclass('design_private.model_candidate_access') is not null
    or to_regclass('design_private.model_candidate_acceptances') is not null then
    raise exception 'SYNTHETIC_CANDIDATE_FIXTURE_REQUIRED';
  end if;
end $$;

create table design_private.model_candidates (
  candidate_id text primary key check(candidate_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  scope_key text not null check(scope_key ~ '^[0-9a-f]{64}$'),
  envelope jsonb not null check(jsonb_typeof(envelope)='object'),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create table design_private.model_candidate_access (
  candidate_id text primary key references design_private.model_candidates(candidate_id),
  active boolean not null,
  revision integer not null check(revision>=1)
);
create table design_private.model_candidate_acceptances (
  candidate_id text primary key references design_private.model_candidates(candidate_id),
  receipt jsonb not null check(jsonb_typeof(receipt)='object')
);
create trigger model_candidates_immutable before update or delete on design_private.model_candidates
  for each row execute function design_private.reject_rewrite();
create trigger model_candidate_acceptances_immutable before update or delete on design_private.model_candidate_acceptances
  for each row execute function design_private.reject_rewrite();

create function design_private.guard_candidate_revocation() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or new.candidate_id is distinct from old.candidate_id
    or old.active=false or new.active<>false or new.revision<>old.revision+1 then
    raise exception 'DESIGN_CANDIDATE_REVOCATION_ONLY' using errcode='42501';
  end if;
  return new;
end $$;
create trigger model_candidate_access_revocation_only before update or delete on design_private.model_candidate_access
  for each row execute function design_private.guard_candidate_revocation();
revoke all on design_private.model_candidates,design_private.model_candidate_access,design_private.model_candidate_acceptances from public,anon,authenticated;
revoke all on function design_private.guard_candidate_revocation() from public,anon,authenticated;
