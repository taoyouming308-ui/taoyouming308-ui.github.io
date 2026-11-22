\set ON_ERROR_STOP on
DO $$
DECLARE a jsonb;b jsonb;c jsonb;rows jsonb;excluded jsonb;outcome jsonb;n int;today text:=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD');future text:=to_char((clock_timestamp() at time zone 'Asia/Shanghai')::date+1,'YYYY-MM-DD');
BEGIN
 rows:=jsonb_build_array(jsonb_build_object('id',101,'shop_id','1009951','shop_name','自由手艺人','barber_name','synthetic','reservation_time',(extract(epoch from (today::date+time '12:00') at time zone 'Asia/Shanghai')*1000)::bigint,'date',today,'status',3));
 a:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 BEGIN PERFORM public.mgj_booking_begin_v2('1837032',today,gen_random_uuid()); RAISE EXCEPTION 'parallel lease accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'lease_busy' THEN RAISE; END IF; END;
 outcome:=public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,true,rows);
 ASSERT outcome->>'upserted'='1';
 n:=(SELECT count(*) FROM booking_private.mutations);
 ASSERT public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,true,rows)=outcome;
 ASSERT (SELECT count(*) FROM booking_private.mutations)=n;
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,'[]',true,'[]'); RAISE EXCEPTION 'bad replay accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'replay_payload_mismatch' THEN RAISE; END IF; END;
 b:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(b->>'lease_id')::uuid,'[]',true,rows); RAISE EXCEPTION 'filtered valid row accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'source_subset_mismatch' THEN RAISE; END IF; END;
 ASSERT EXISTS(SELECT FROM public.bookings WHERE id=101);
 excluded:=jsonb_set(rows,'{0,status}','2');
 PERFORM public.mgj_booking_commit_v2('1009951',today,(b->>'lease_id')::uuid,'[]',true,excluded);
 ASSERT NOT EXISTS(SELECT FROM public.bookings WHERE id=101);
 ASSERT EXISTS(SELECT FROM booking_private.mutations WHERE booking_id=101 AND operation='DELETE' AND reason='source_excluded_status');
 c:=public.mgj_booking_begin_v2('1009951',future,gen_random_uuid());
 PERFORM public.mgj_booking_abort_v2('1009951',future,(c->>'lease_id')::uuid);
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',future,(c->>'lease_id')::uuid,'[]',true,'[]'); RAISE EXCEPTION 'aborted accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'aborted_lease' THEN RAISE; END IF; END;
 a:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,false,rows); RAISE EXCEPTION 'incomplete accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'incomplete_source' THEN RAISE; END IF; END;
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,true,rows||rows); RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'duplicate_source_ids' THEN RAISE; END IF; END;
 PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,true,rows);
 b:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 PERFORM public.mgj_booking_commit_v2('1009951',today,(b->>'lease_id')::uuid,'[]',true,'[]');
 ASSERT EXISTS(SELECT FROM booking_private.mutations WHERE booking_id=101 AND operation='DELETE' AND reason='missing_from_complete_source');
 c:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 UPDATE booking_private.leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=(c->>'lease_id')::uuid;
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(c->>'lease_id')::uuid,rows,true,rows); RAISE EXCEPTION 'expired accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'expired_lease' THEN RAISE; END IF; END;
 ASSERT NOT has_function_privilege('anon','public.mgj_booking_commit_v2(text,text,uuid,jsonb,boolean,jsonb)','EXECUTE');
 ASSERT NOT has_schema_privilege('authenticated','booking_private','USAGE');
END $$;
SELECT '17 v2 assertions passed' result;
