\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION public.test_booking_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.notes='synthetic_failure' THEN RAISE EXCEPTION 'synthetic_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_booking_failure BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.test_booking_failure();
DO $$
DECLARE d text:=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD'); a jsonb; b jsonb; rows jsonb; audit_count int;
BEGIN
 INSERT INTO public.bookings(id,shop_id,shop_name,barber_name,reservation_time,date) VALUES(301,'1009951','自由手艺人','synthetic',1,d),(302,'1837032','向里造型','synthetic',1,d);
 a:=public.mgj_booking_begin_v2('1009951',d,gen_random_uuid());
 rows:=jsonb_build_array(jsonb_build_object('id',303,'shop_id','1009951','shop_name','自由手艺人','barber_name','synthetic','reservation_time',(extract(epoch from (d::date+time '12:00') at time zone 'Asia/Shanghai')*1000)::bigint,'date',d,'status',3,'notes','synthetic_failure'));
 audit_count:=(select count(*) from booking_private.mutations);
 BEGIN PERFORM public.mgj_booking_commit_v2('1009951',d,(a->>'lease_id')::uuid,rows,true,rows); RAISE EXCEPTION 'failure not raised';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_failure' THEN RAISE; END IF; END;
 ASSERT EXISTS(select from public.bookings where id=301),'failed replacement preserved old pair';
 ASSERT EXISTS(select from public.bookings where id=302),'other shop preserved';
 ASSERT NOT EXISTS(select from public.bookings where id=303),'no partial insert';
 ASSERT (select count(*) from booking_private.mutations)=audit_count,'audit and data rolled back together';
 ASSERT (select result is null from booking_private.leases where id=(a->>'lease_id')::uuid),'no success receipt after failure';
 PERFORM public.mgj_booking_abort_v2('1009951',d,(a->>'lease_id')::uuid);
END $$;
ROLLBACK;
SELECT '5 atomic rollback assertions passed' result;
