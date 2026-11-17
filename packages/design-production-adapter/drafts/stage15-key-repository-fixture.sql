-- OFFLINE SYNTHETIC ONLY. Not a production migration or issuer UI.
-- No plaintext keys or encryption master key enter this repository.
-- Ciphertext/keyDigest correspondence trusts the reviewed sealer, not SQL.
do $$ begin
 if current_database()<>'design_executor_synthetic' or current_setting('design_executor.synthetic_fixture',true) is distinct from 'offline-stage6-only'
 or current_setting('server_version_num')::int/10000<>17 or to_regclass('design_identity.sessions') is null
 or exists(select 1 from pg_catalog.pg_namespace where nspname='design_key_private')
 or exists(select 1 from pg_catalog.pg_roles where rolname in ('design_key_issuer','design_key_issuer_capability')) then raise exception 'SYNTHETIC_KEY_FIXTURE_REQUIRED'; end if;
end $$;
create role design_key_issuer login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role design_key_issuer_capability nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant connect on database design_executor_synthetic to design_key_issuer;
create schema design_key_private authorization design_identity_owner;
revoke all on schema design_key_private from public,anon,authenticated;
grant usage on schema design_key_private to design_identity_runtime,design_identity_capability,design_key_issuer,design_key_issuer_capability;
grant create on schema design_key_private to design_identity_capability,design_key_issuer_capability;
create table design_key_private.transaction_contexts(login name not null,pid int not null,xid bigint not null,session_hash text not null,identity jsonb not null,expires_at timestamptz not null,primary key(login,pid,xid));
create table design_key_private.approvals(receipt_id text primary key,intent jsonb not null,issued_at timestamptz not null,expires_at timestamptz not null,revoked boolean not null default false,ttl_ms bigint not null check(ttl_ms between 1 and 300000));
create table design_key_private.key_heads(owner jsonb not null,purpose text not null,revision bigint not null check(revision>0),primary key(owner,purpose));
create table design_key_private.key_versions(owner jsonb not null,purpose text not null,revision bigint not null check(revision>0),record jsonb not null,receipt_id text not null unique,primary key(owner,purpose,revision),unique(receipt_id,owner,purpose,revision));
create table design_key_private.consumptions(receipt_id text primary key references design_key_private.approvals(receipt_id),owner jsonb not null,purpose text not null,target_revision bigint not null,login name not null,pid int not null,xid bigint not null,expires_at timestamptz not null,unique(receipt_id,owner,purpose,target_revision));
alter table design_key_private.consumptions add foreign key(receipt_id,owner,purpose,target_revision) references design_key_private.key_versions(receipt_id,owner,purpose,revision) deferrable initially deferred;
alter table design_key_private.key_versions add foreign key(receipt_id,owner,purpose,revision) references design_key_private.consumptions(receipt_id,owner,purpose,target_revision) deferrable initially deferred;
alter table design_key_private.key_heads add foreign key(owner,purpose,revision) references design_key_private.key_versions(owner,purpose,revision) deferrable initially deferred;
alter table design_key_private.transaction_contexts owner to design_identity_owner;
alter table design_key_private.transaction_contexts enable row level security;
alter table design_key_private.transaction_contexts force row level security;
create policy key_cap_transaction_contexts on design_key_private.transaction_contexts to design_identity_capability using(true) with check(true);
alter table design_key_private.approvals owner to design_identity_owner;
alter table design_key_private.approvals enable row level security;
alter table design_key_private.approvals force row level security;
create policy key_cap_approvals on design_key_private.approvals to design_identity_capability using(true) with check(true);
alter table design_key_private.key_heads owner to design_identity_owner;
alter table design_key_private.key_heads enable row level security;
alter table design_key_private.key_heads force row level security;
create policy key_cap_key_heads on design_key_private.key_heads to design_identity_capability using(true) with check(true);
alter table design_key_private.key_versions owner to design_identity_owner;
alter table design_key_private.key_versions enable row level security;
alter table design_key_private.key_versions force row level security;
create policy key_cap_key_versions on design_key_private.key_versions to design_identity_capability using(true) with check(true);
alter table design_key_private.consumptions owner to design_identity_owner;
alter table design_key_private.consumptions enable row level security;
alter table design_key_private.consumptions force row level security;
create policy key_cap_consumptions on design_key_private.consumptions to design_identity_capability using(true) with check(true);
grant select,insert,update,delete on design_key_private.transaction_contexts to design_identity_capability;
grant select,update(receipt_id) on design_key_private.approvals to design_identity_capability;
grant select,insert,update on design_key_private.key_heads to design_identity_capability;
grant select,insert on design_key_private.key_versions,design_key_private.consumptions to design_identity_capability;
create policy key_issuer_approvals on design_key_private.approvals to design_key_issuer_capability using(true) with check(true);
grant select,insert,update(revoked) on design_key_private.approvals to design_key_issuer_capability;
create function design_key_private.owner_of(i jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$ select jsonb_build_object('subjectId',i->'subjectId','employmentId',i->'employmentId','membershipId',i->'membershipId','storeId',i->'storeId') $$;
create function design_key_private.resolve_hash(h text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s design_identity.sessions%rowtype;p design_identity.subjects%rowtype;e design_identity.employments%rowtype;m design_identity.memberships%rowtype;st design_identity.stores%rowtype;a design_identity.aliases%rowtype;l record;employee record;deadline timestamptz;
begin
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 select token_hash,username,store,expires_at into strict l from public.employee_booking_sessions where token_hash=h for share;
 select * into strict s from design_identity.sessions where session_hash=h for share;
 select * into strict p from design_identity.subjects where subject_id=s.subject_id for share;
 select * into strict e from design_identity.employments where employment_id=s.employment_id for share;
 select * into strict m from design_identity.memberships where membership_id=s.membership_id for share;
 select * into strict st from design_identity.stores where store_id=m.store_id for share;
 select * into strict a from design_identity.aliases where membership_id=m.membership_id and active for share;
 select username,store,active,employment_status into strict employee from public.staff where username=a.username for share;
 if s.revoked is distinct from false or p.active is distinct from true or e.active is distinct from true or m.active is distinct from true or st.active is distinct from true
 or e.subject_id is distinct from p.subject_id or m.employment_id is distinct from e.employment_id or a.store_id is distinct from m.store_id
 or s.security_epoch is distinct from p.security_epoch or s.membership_revision is distinct from m.membership_revision
 or l.username is distinct from a.username or l.store is distinct from st.label or employee.store is distinct from st.label or employee.active is distinct from true or employee.employment_status is distinct from 'active'
 or l.expires_at is null or s.expires_at is null then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 deadline:=least(l.expires_at,s.expires_at);
 if deadline<=clock_timestamp() then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('schemaVersion','design-key-identity-v2','subjectId',p.subject_id,'employmentId',e.employment_id,'membershipId',m.membership_id,'storeId',st.store_id,'securityEpoch',p.security_epoch,'membershipRevision',m.membership_revision,'expiresAt',floor(extract(epoch from deadline)*1000)::bigint);
exception when no_data_found or too_many_rows then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end $$;
create function design_key_private.authenticate(c text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i jsonb;h text;
begin
 if session_user<>'design_identity_runtime' or c is null or length(c) not between 32 and 200 or c ~ '[[:space:][:cntrl:]]' then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 h:=encode(sha256(convert_to(c,'UTF8')),'hex');i:=design_key_private.resolve_hash(h);
 delete from design_key_private.transaction_contexts where login=session_user and pid=pg_backend_pid();
 insert into design_key_private.transaction_contexts values(session_user,pg_backend_pid(),txid_current(),h,i,to_timestamp((i->>'expiresAt')::numeric/1000));return i;
end $$;
create function design_key_private.require_identity() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c design_key_private.transaction_contexts%rowtype;i jsonb;
begin
 if session_user<>'design_identity_runtime' then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
 select * into strict c from design_key_private.transaction_contexts where login=session_user and pid=pg_backend_pid() and xid=txid_current() for share;
 i:=design_key_private.resolve_hash(c.session_hash);
 if c.expires_at<=clock_timestamp() or i is distinct from c.identity then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;return i;
exception when no_data_found or too_many_rows then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501'; end $$;
create function design_key_private.recheck_identity(expected jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i jsonb;begin i:=design_key_private.require_identity();if i is distinct from expected then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501';end if;return i;end $$;
create function design_key_private.clear_context() returns void language plpgsql security definer set search_path=pg_catalog as $$
begin if session_user<>'design_identity_runtime' then raise exception 'KEY_AUTHENTICATION_REQUIRED' using errcode='42501';end if;delete from design_key_private.transaction_contexts where login=session_user and pid=pg_backend_pid() and xid=txid_current();end $$;
create function design_key_private.checked_intent(i jsonb,a jsonb) returns void language plpgsql set search_path=pg_catalog as $$
begin
 if jsonb_typeof(i) is distinct from 'object' or (i-array['schemaVersion','subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','purpose','action','destination','model','expectedRevision','keyDigest'])<>'{}'::jsonb or (select count(*) from jsonb_object_keys(i))<>13
 or i->>'schemaVersion' is distinct from 'design-key-approval-v2' or design_key_private.owner_of(i) is distinct from design_key_private.owner_of(a)
 or i->'securityEpoch' is distinct from a->'securityEpoch' or i->'membershipRevision' is distinct from a->'membershipRevision'
 or jsonb_typeof(i->'purpose') is distinct from 'string' or i->>'purpose' not in ('chat','speech') or jsonb_typeof(i->'action') is distinct from 'string' or i->>'action' not in ('persist-design-key','revoke-design-key')
 or jsonb_typeof(i->'expectedRevision') is distinct from 'number' or (i->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,15})$' or (i->>'expectedRevision')::numeric>=9007199254740991
 or (i->>'purpose'='chat' and (i->>'destination' is distinct from 'https://api.deepseek.com/chat/completions' or jsonb_typeof(i->'model') is distinct from 'string' or (i->>'model') !~ '^[A-Za-z0-9._-]{1,100}$'))
 or (i->>'purpose'='speech' and (i->>'destination' is distinct from 'https://api.deepseek.com/v1/tools/asr' or i->'model' is distinct from 'null'::jsonb))
 or (i->>'action'='persist-design-key' and (jsonb_typeof(i->'keyDigest') is distinct from 'string' or (i->>'keyDigest') !~ '^[A-Za-z0-9+/]{43}=$'))
 or (i->>'action'='revoke-design-key' and i->'keyDigest' is distinct from 'null'::jsonb)
 then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end if;
end $$;
create function design_key_private.issue_approval(c text,r text,i jsonb,ttl_ms bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb;t timestamptz;deadline timestamptz;prior design_key_private.approvals%rowtype;
begin
 if session_user<>'design_key_issuer' or c is null or length(c) not between 32 and 200 or c ~ '[[:space:][:cntrl:]]' or r is null or r !~ '^[A-Za-z0-9:_-]{1,160}$' or ttl_ms is null or ttl_ms not between 1 and 300000 then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end if;
 a:=design_key_private.resolve_hash(encode(sha256(convert_to(c,'UTF8')),'hex'));perform design_key_private.checked_intent(i,a);
 perform pg_advisory_xact_lock(hashtextextended('key-approval:'||r,0));
 select * into prior from design_key_private.approvals where receipt_id=r;
 if found then
  if prior.intent is distinct from i or prior.ttl_ms is distinct from ttl_ms then raise exception 'KEY_APPROVAL_CONFLICT' using errcode='42501';end if;
  return jsonb_build_object('receiptId',r,'issuedAt',floor(extract(epoch from prior.issued_at)*1000)::bigint,'expiresAt',floor(extract(epoch from prior.expires_at)*1000)::bigint);
 end if;
 t:=clock_timestamp();deadline:=least(t+ttl_ms*interval '1 millisecond',to_timestamp((a->>'expiresAt')::numeric/1000));
 insert into design_key_private.approvals values(r,i,t,deadline,false,ttl_ms);
 return jsonb_build_object('receiptId',r,'issuedAt',floor(extract(epoch from t)*1000)::bigint,'expiresAt',floor(extract(epoch from deadline)*1000)::bigint);
end $$;
create function design_key_private.revoke_approval(r text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin if session_user<>'design_key_issuer' then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end if;update design_key_private.approvals set revoked=true where receipt_id=r;return found;end $$;
create function design_key_private.lock_slot(o jsonb,p text) returns void language plpgsql set search_path=pg_catalog as $$
begin if p is null or p not in ('chat','speech') then raise exception 'KEY_RECORD_INVALID' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(o::text||':'||p,0));end $$;
create function design_key_private.read_key(p text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i jsonb;o jsonb;v jsonb;
begin i:=design_key_private.require_identity();o:=design_key_private.owner_of(i);perform design_key_private.lock_slot(o,p);
 select v1.record into v from design_key_private.key_heads h join design_key_private.key_versions v1 using(owner,purpose,revision) where h.owner=o and h.purpose=p;
 perform design_key_private.require_identity();return v;end $$;
create function design_key_private.consume_approval(r text,i jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb;o jsonb;ap design_key_private.approvals%rowtype;rev bigint;
begin a:=design_key_private.require_identity();perform design_key_private.checked_intent(i,a);o:=design_key_private.owner_of(a);perform design_key_private.lock_slot(o,i->>'purpose');
 select * into strict ap from design_key_private.approvals where receipt_id=r for update;
 if ap.revoked or ap.expires_at<=clock_timestamp() or ap.intent is distinct from i then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end if;
 select revision into rev from design_key_private.key_heads where owner=o and purpose=i->>'purpose';
 if coalesce(rev,0)<>(i->>'expectedRevision')::bigint then raise exception 'KEY_REVISION_CONFLICT' using errcode='42501';end if;
 if i->>'action'='revoke-design-key' and rev is null then raise exception 'KEY_NOT_CONFIGURED' using errcode='42501';end if;
 insert into design_key_private.consumptions values(r,o,i->>'purpose',(i->>'expectedRevision')::bigint+1,session_user,pg_backend_pid(),txid_current(),ap.expires_at);
 perform design_key_private.require_identity();return true;
exception when no_data_found or unique_violation then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end $$;
create function design_key_private.cas_key(expected bigint,n jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb;o jsonb;c design_key_private.consumptions%rowtype;i jsonb;rev bigint;oldrow jsonb;
begin a:=design_key_private.require_identity();o:=design_key_private.owner_of(a);
 if expected is null or expected<0 or expected>=9007199254740991 or jsonb_typeof(n) is distinct from 'object'
 or (n-array['schemaVersion','owner','securityEpoch','membershipRevision','purpose','revision','enabled','destination','model','sealed'])<>'{}'::jsonb or (select count(*) from jsonb_object_keys(n))<>10
 or n->>'schemaVersion' is distinct from 'design-key-record-v2' or n->'owner' is distinct from o or n->'securityEpoch' is distinct from a->'securityEpoch' or n->'membershipRevision' is distinct from a->'membershipRevision'
 or n->'revision' is distinct from to_jsonb(expected+1) or jsonb_typeof(n->'enabled') is distinct from 'boolean' then raise exception 'KEY_RECORD_INVALID' using errcode='42501';end if;
 perform design_key_private.lock_slot(o,n->>'purpose');
 select * into strict c from design_key_private.consumptions where owner=o and purpose=n->>'purpose' and target_revision=expected+1 and login=session_user and pid=pg_backend_pid() and xid=txid_current();
 select intent into strict i from design_key_private.approvals where receipt_id=c.receipt_id and not revoked and expires_at>clock_timestamp() for share;
 if c.expires_at<=clock_timestamp() or n->'destination' is distinct from i->'destination' or n->'model' is distinct from i->'model' or n->'enabled' is distinct from to_jsonb(i->>'action'='persist-design-key') then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end if;
 select revision into rev from design_key_private.key_heads where owner=o and purpose=n->>'purpose';if coalesce(rev,0)<>expected then raise exception 'KEY_REVISION_CONFLICT' using errcode='42501';end if;
 if (n->>'enabled')::boolean then
  if jsonb_typeof(n->'sealed') is distinct from 'object' or ((n->'sealed')-array['v','iv','data'])<>'{}'::jsonb or (select count(*) from jsonb_object_keys(n->'sealed'))<>3 or n->'sealed'->'v' is distinct from '2'::jsonb
  or jsonb_typeof(n->'sealed'->'iv') is distinct from 'string' or (n->'sealed'->>'iv') !~ '^[A-Za-z0-9+/]{16}$'
  or jsonb_typeof(n->'sealed'->'data') is distinct from 'string' or length(n->'sealed'->>'data') not between 24 and 5464 or (n->'sealed'->>'data') !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'KEY_RECORD_INVALID' using errcode='42501';end if;
   if encode(decode(n->'sealed'->>'iv','base64'),'base64') is distinct from n->'sealed'->>'iv' or octet_length(decode(n->'sealed'->>'iv','base64'))<>12
  or replace(encode(decode(n->'sealed'->>'data','base64'),'base64'),E'\n','') is distinct from n->'sealed'->>'data' or octet_length(decode(n->'sealed'->>'data','base64')) not between 16 and 4096 then raise exception 'KEY_RECORD_INVALID' using errcode='42501';end if;
 else
  oldrow:=design_key_private.read_key(n->>'purpose');
  if n->'sealed' is distinct from 'null'::jsonb or oldrow is null or oldrow->'destination' is distinct from n->'destination' or oldrow->'model' is distinct from n->'model' then raise exception 'KEY_RECORD_INVALID' using errcode='42501';end if;
 end if;
 insert into design_key_private.key_versions values(o,n->>'purpose',expected+1,n,c.receipt_id);
 insert into design_key_private.key_heads values(o,n->>'purpose',expected+1) on conflict(owner,purpose) do update set revision=excluded.revision;
 perform design_key_private.require_identity();return true;
exception when no_data_found or too_many_rows then raise exception 'KEY_APPROVAL_REQUIRED' using errcode='42501';end $$;
-- Defensive immutable rows. API privileges are narrower than these triggers.
create function design_key_private.guard_row() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'KEY_IMMUTABLE' using errcode='42501';end if;
 if tg_table_name='approvals' then
  if (to_jsonb(new)-'revoked')=(to_jsonb(old)-'revoked') and (not old.revoked or new.revoked) then return new;end if;
 elsif tg_table_name='key_heads' then
  if new.owner=old.owner and new.purpose=old.purpose and new.revision=old.revision+1 then return new;end if;
 end if;
 raise exception 'KEY_IMMUTABLE' using errcode='42501';end $$;
create function design_key_private.check_deadline() returns trigger language plpgsql set search_path=pg_catalog as $$
begin if new.expires_at<=clock_timestamp() then raise exception 'KEY_AUTHORITY_EXPIRED' using errcode='42501';end if;return new;end $$;
-- Known limitation: an arbitrary SQL caller can force deferred constraints early;
-- this is not an absolute wall-clock expiry guarantee after SET CONSTRAINTS.
create trigger key_immutable before update or delete on design_key_private.approvals for each row execute function design_key_private.guard_row();
create trigger key_immutable before update or delete on design_key_private.key_heads for each row execute function design_key_private.guard_row();
create trigger key_immutable before update or delete on design_key_private.key_versions for each row execute function design_key_private.guard_row();
create trigger key_immutable before update or delete on design_key_private.consumptions for each row execute function design_key_private.guard_row();
create constraint trigger key_deadline after insert or update on design_key_private.transaction_contexts deferrable initially deferred for each row execute function design_key_private.check_deadline();
create constraint trigger key_deadline after insert or update on design_key_private.consumptions deferrable initially deferred for each row execute function design_key_private.check_deadline();
alter function design_key_private.owner_of(jsonb) owner to design_identity_capability;
alter function design_key_private.resolve_hash(text) owner to design_identity_capability;
alter function design_key_private.authenticate(text) owner to design_identity_capability;
alter function design_key_private.require_identity() owner to design_identity_capability;
alter function design_key_private.recheck_identity(jsonb) owner to design_identity_capability;
alter function design_key_private.clear_context() owner to design_identity_capability;
alter function design_key_private.checked_intent(jsonb,jsonb) owner to design_identity_capability;
alter function design_key_private.issue_approval(text,text,jsonb,bigint) owner to design_key_issuer_capability;
alter function design_key_private.revoke_approval(text) owner to design_key_issuer_capability;
alter function design_key_private.lock_slot(jsonb,text) owner to design_identity_capability;
alter function design_key_private.read_key(text) owner to design_identity_capability;
alter function design_key_private.consume_approval(text,jsonb) owner to design_identity_capability;
alter function design_key_private.cas_key(bigint,jsonb) owner to design_identity_capability;
alter function design_key_private.guard_row() owner to design_identity_capability;
alter function design_key_private.check_deadline() owner to design_identity_capability;
revoke all on all functions in schema design_key_private from public,anon,authenticated,design_identity_runtime,design_key_issuer;
revoke all on all tables in schema design_key_private from public,anon,authenticated,design_identity_runtime,design_key_issuer;
grant execute on function design_key_private.resolve_hash(text),design_key_private.checked_intent(jsonb,jsonb),design_key_private.owner_of(jsonb) to design_key_issuer_capability;
grant execute on function design_key_private.authenticate(text),design_key_private.recheck_identity(jsonb),design_key_private.clear_context(),design_key_private.read_key(text),design_key_private.consume_approval(text,jsonb),design_key_private.cas_key(bigint,jsonb) to design_identity_runtime;
grant execute on function design_key_private.issue_approval(text,text,jsonb,bigint),design_key_private.revoke_approval(text) to design_key_issuer;
revoke create on schema design_key_private from design_identity_capability,design_key_issuer_capability;
