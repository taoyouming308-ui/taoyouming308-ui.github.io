-- TEST FIXTURE ONLY. Additive to the empty disposable Stage6 fixture, never a
-- production migration, installer, credential issuer or permission grant.
do $$
begin
  if current_database() <> 'design_executor_synthetic'
    or current_setting('design_executor.synthetic_fixture',true) is distinct from 'offline-stage6-only'
    or current_setting('design_workflow.synthetic_fixture',true) is distinct from 'offline-stage7-only'
    or current_setting('server_version_num')::integer / 10000 <> 17
    or to_regclass('design_private.runtime_contract') is null
    or to_regclass('design_private.workflow_contract') is not null
    or to_regclass('design_private.workflow_versions') is not null
    or to_regclass('design_private.workflow_receipts') is not null
    or to_regclass('design_private.full_versions') is not null
    or to_regclass('design_private.full_receipts') is not null
    or to_regclass('design_private.media_records') is not null
    or to_regclass('design_private.media_access') is not null then
    raise exception 'SYNTHETIC_WORKFLOW_FIXTURE_REQUIRED';
  end if;
end $$;

create table design_private.workflow_contract (
  id boolean primary key check(id), version text not null
);
insert into design_private.workflow_contract values(true,'design-workflow-postgres-v1');
create table design_private.workflow_versions (
  scope_key text not null check(scope_key ~ '^[0-9a-f]{64}$'),
  revision integer not null check(revision >= 0),
  record jsonb not null check(jsonb_typeof(record)='object'),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  previous_sha256 text check(previous_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_key text unique check(receipt_key ~ '^[0-9a-f]{64}$'),
  primary key(scope_key,revision),
  check((record->>'revision')::integer=revision),
  check((revision=0 and previous_sha256 is null and receipt_key is null)
    or (revision>0 and previous_sha256 is not null and receipt_key is not null))
);
create table design_private.workflow_receipts (
  request_key text primary key check(request_key ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  record_sha256 text not null check(record_sha256 ~ '^[0-9a-f]{64}$')
);
create table design_private.full_versions (
  scope_key text not null check(scope_key ~ '^[0-9a-f]{64}$'),
  version integer not null check(version between 1 and 100),
  record jsonb not null check(jsonb_typeof(record)='object'),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  primary key(scope_key,version),
  check((record->>'version')::integer=version),
  check(record->>'sha256'=sha256)
);
create table design_private.full_receipts (
  request_key text primary key check(request_key ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  check(receipt->>'requestKey'=request_key)
);
create table design_private.media_records (
  binding_key text not null check(binding_key ~ '^[0-9a-f]{64}$'),
  media_id text not null check(media_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  record jsonb not null check(jsonb_typeof(record)='object'),
  record_sha256 text not null check(record_sha256 ~ '^[0-9a-f]{64}$'),
  primary key(binding_key,media_id),
  check(record->>'mediaId'=media_id and record->>'requestId'=media_id),
  check(record->'active'='true'::jsonb)
);
create table design_private.media_access (
  binding_key text not null,
  media_id text not null,
  active boolean not null,
  revision integer not null check(revision>0),
  primary key(binding_key,media_id),
  foreign key(binding_key,media_id) references design_private.media_records(binding_key,media_id)
);
create trigger workflow_versions_immutable before update or delete on design_private.workflow_versions for each row execute function design_private.reject_rewrite();
create trigger workflow_receipts_immutable before update or delete on design_private.workflow_receipts for each row execute function design_private.reject_rewrite();
create trigger full_versions_immutable before update or delete on design_private.full_versions for each row execute function design_private.reject_rewrite();
create trigger full_receipts_immutable before update or delete on design_private.full_receipts for each row execute function design_private.reject_rewrite();
create trigger media_records_immutable before update or delete on design_private.media_records for each row execute function design_private.reject_rewrite();

create function design_private.guard_media_revocation() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or new.binding_key is distinct from old.binding_key
    or new.media_id is distinct from old.media_id
    or old.active=false or new.active<>false
    or new.revision<>old.revision+1 then
    raise exception 'DESIGN_MEDIA_REVOCATION_ONLY' using errcode='42501';
  end if;
  return new;
end $$;
create trigger media_access_revocation_only before update or delete on design_private.media_access for each row execute function design_private.guard_media_revocation();
revoke all on design_private.workflow_contract,design_private.workflow_versions,design_private.workflow_receipts,design_private.full_versions,design_private.full_receipts,design_private.media_records,design_private.media_access from public,anon,authenticated;
revoke all on function design_private.guard_media_revocation() from public,anon,authenticated;
