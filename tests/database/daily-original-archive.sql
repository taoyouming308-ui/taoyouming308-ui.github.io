\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role;
create schema zysyr_private;
create table public.synthetic_authority(enabled boolean); insert into public.synthetic_authority values(true);
create function zysyr_private.account_has_capability(uuid,uuid,uuid,text) returns boolean language sql as $$select enabled and $1='00000000-0000-0000-0000-000000000001'::uuid and $3='00000000-0000-0000-0000-000000000003'::uuid from public.synthetic_authority$$;
create function zysyr_private.assert_daily_entry_scope(uuid,uuid,uuid) returns void language plpgsql as $$begin if not zysyr_private.account_has_capability($1,$2,$3,'daily_report.write') then raise exception 'DENIED'; end if; end$$;
create function zysyr_private.protect_report_trace_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE'; end$$;
-- Sentinel financial/source records are deliberately not dependencies of the migration.
create table public.synthetic_financial(id int,status text,locked boolean,amount numeric,source_id uuid,revision int);
insert into public.synthetic_financial values(1,'posted',true,123,null,7),(2,'draft',false,456,null,2);
create temp table digest_before as select md5(jsonb_agg(to_jsonb(f))::text) digest from public.synthetic_financial f;
\ir ../../supabase/migrations/20261112053748_daily_original_independent_archive.sql
create function public.test_archive(action text, req uuid default '00000000-0000-0000-0000-000000000004', meta jsonb default '{"report_date":"2026-10-01","original_filename":"test.png","mime_type":"image/png","size_bytes":123,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","note":""}') returns jsonb language sql as $$ select public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',action,req,meta) $$;
do $$declare r jsonb; begin
 r:=public.test_archive('reserve'); assert (r->>'newly_reserved')::boolean;
 r:=public.test_archive('reserve'); assert not (r->>'newly_reserved')::boolean;
 r:=public.test_archive('status'); assert r->>'status'='pending';
 r:=public.test_archive('complete'); assert r->>'status'='archived';
 r:=public.test_archive('complete'); assert r->>'status'='archived';
 begin perform public.test_archive('reserve','00000000-0000-0000-0000-000000000004',r->'archive'); raise exception 'FAIL mismatch'; exception when others then if SQLERRM='FAIL mismatch' then raise; end if; end;
 assert (select count(*)=1 from public.zysyr_daily_original_completions);
 assert not has_function_privilege('anon','public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE');
 assert has_function_privilege('service_role','public.zysyr_daily_original_archive(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege('service_role','public.zysyr_daily_original_reservations','INSERT');
 update public.synthetic_authority set enabled=false;
 begin perform public.test_archive('status'); raise exception 'FAIL revoked'; exception when others then if SQLERRM='FAIL revoked' then raise; end if; end;
 assert (select digest from digest_before)=(select md5(jsonb_agg(to_jsonb(f))::text) from public.synthetic_financial f);
end$$;
select 'archive isolated assertions passed';
do $$declare m jsonb; begin
 update public.synthetic_authority set enabled=true;
 select metadata into m from public.zysyr_daily_original_reservations limit 1;
 begin perform public.test_archive('reserve','00000000-0000-0000-0000-000000000004',m||'{"note":"changed"}'::jsonb); raise exception 'FAIL binding'; exception when others then if SQLERRM='FAIL binding' then raise; end if; end;
 begin perform public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000088','status','00000000-0000-0000-0000-000000000004','{}'); raise exception 'FAIL scope'; exception when others then if SQLERRM='FAIL scope' then raise; end if; end;
 begin update public.zysyr_daily_original_completions set completed_by=completed_by; raise exception 'FAIL immutable'; exception when others then if SQLERRM='FAIL immutable' then raise; end if; end;
end$$;
-- A second authorized actor sees completed evidence but never another actor's pending item.
create or replace function zysyr_private.account_has_capability(uuid,uuid,uuid,text) returns boolean language sql as $$select enabled and $1 in ('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000005'::uuid) and $3='00000000-0000-0000-0000-000000000003'::uuid from public.synthetic_authority$$;
do $$declare r jsonb; begin
 perform public.test_archive('reserve','00000000-0000-0000-0000-000000000006');
 r:=public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','list',null,'{"month":"2026-10"}');
 assert jsonb_array_length(r->'archives')=2;
 r:=public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','list',null,'{"month":"2026-10"}');
 assert jsonb_array_length(r->'archives')=1;
 r:=public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','view','00000000-0000-0000-0000-000000000004','{}');
 assert r->>'status'='archived';
 r:=public.zysyr_daily_original_archive('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','view','00000000-0000-0000-0000-000000000006','{}');
 assert r->>'status'='not_found';
end$$;
