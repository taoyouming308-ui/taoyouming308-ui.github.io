\set ON_ERROR_STOP on
DO $$
DECLARE req uuid:=gen_random_uuid();a jsonb;b jsonb;rows jsonb;today text:=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD');n int;aid bigint;
BEGIN
 a:=public.mgj_booking_begin_v2('1009951',today,req);
 ASSERT a=public.mgj_booking_begin_v2('1009951',today,req),'begin replay stable';
 rows:=jsonb_build_array(jsonb_build_object('id',202,'shop_id','1009951','shop_name','自由手艺人','barber_name','synthetic','reservation_time',(extract(epoch from (today::date+time '12:00') at time zone 'Asia/Shanghai')*1000)::bigint,'date',today,'status',3));
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,jsonb_set(rows,'{0,reservation_time}','0'),true,jsonb_set(rows,'{0,reservation_time}','0')); RAISE EXCEPTION 'zero time accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_source_row' THEN RAISE; END IF; END;
 PERFORM public.mgj_booking_commit_v2('1009951',today,(a->>'lease_id')::uuid,rows,true,rows);
 n:=(SELECT count(*) FROM booking_private.mutations);
 b:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 PERFORM public.mgj_booking_commit_v2('1009951',today,(b->>'lease_id')::uuid,rows,true,rows);
 ASSERT (SELECT count(*) FROM booking_private.mutations)=n,'freshness no duplicate PII';
 b:=public.mgj_booking_begin_v2('1009951',today,gen_random_uuid());
 PERFORM public.mgj_booking_commit_v2('1009951',today,(b->>'lease_id')::uuid,'[]',true,'[]');
 SELECT audit_id INTO aid FROM booking_private.mutations WHERE booking_id=202 AND operation='DELETE' ORDER BY audit_id DESC LIMIT 1;
 ASSERT (SELECT lease_id=(b->>'lease_id')::uuid AND generation=(b->>'generation')::bigint FROM booking_private.mutations WHERE audit_id=aid),'audit generation';
 -- Controlled restoration rehearsal: absent current row AND unchanged ID fence.
 INSERT INTO public.bookings SELECT (jsonb_populate_record(NULL::public.bookings,a.old_row)).* FROM booking_private.mutations a JOIN booking_private.id_versions v ON v.id=a.booking_id AND v.generation=a.generation WHERE a.audit_id=aid AND NOT EXISTS(SELECT FROM public.bookings live WHERE live.id=a.booking_id);
 ASSERT EXISTS(SELECT FROM public.bookings WHERE id=202),'recovery works';
 INSERT INTO public.bookings SELECT (jsonb_populate_record(NULL::public.bookings,a.old_row)).* FROM booking_private.mutations a JOIN booking_private.id_versions v ON v.id=a.booking_id AND v.generation=a.generation WHERE a.audit_id=aid AND NOT EXISTS(SELECT FROM public.bookings live WHERE live.id=a.booking_id);
 ASSERT (SELECT count(*)=1 FROM public.bookings WHERE id=202),'no restore overwrite';
END $$;
SELECT '6 final assertions passed' result;
