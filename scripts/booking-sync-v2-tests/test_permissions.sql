\set ON_ERROR_STOP on
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES ON public.bookings FROM service_role;
SET ROLE service_role;
DO $$
DECLARE a jsonb;today text:=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD');
BEGIN
 PERFORM count(*) FROM public.bookings;
 BEGIN DELETE FROM public.bookings WHERE false; RAISE EXCEPTION 'direct delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.bookings SET status=3 WHERE false; RAISE EXCEPTION 'direct update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.bookings(id,shop_id,shop_name,barber_name,reservation_time,date) VALUES(999,'1009951','test','test',0,today); RAISE EXCEPTION 'direct insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.bookings; RAISE EXCEPTION 'truncate allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 a:=public.mgj_booking_begin_v2('1837032',today,gen_random_uuid());
 PERFORM public.mgj_booking_commit_v2('1837032',today,(a->>'lease_id')::uuid,'[]',true,'[]');
END $$;
RESET ROLE;
SELECT '6 permission assertions passed: read and RPC work; direct I/U/D/TRUNCATE denied' result;
