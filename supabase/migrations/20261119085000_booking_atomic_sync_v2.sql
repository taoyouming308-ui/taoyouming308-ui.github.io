-- Atomic, signed appointment mirror replacement with recoverable change audit.
CREATE SCHEMA booking_private;
REVOKE ALL ON SCHEMA booking_private FROM PUBLIC, anon, authenticated;
CREATE TABLE booking_private.mutations (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 operation text NOT NULL CHECK(operation IN ('UPDATE','DELETE')),
 booking_id bigint NOT NULL,
 old_row jsonb NOT NULL,
 new_row jsonb,
 reason text NOT NULL,
 lease_id uuid, generation bigint,
 actor text NOT NULL DEFAULT session_user
);
ALTER TABLE booking_private.mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON booking_private.mutations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION booking_private.capture_before_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'updated_at')=(to_jsonb(NEW)-'updated_at') THEN RETURN NEW; END IF;
 INSERT INTO booking_private.mutations(operation,booking_id,old_row,new_row,reason,lease_id,generation)
 VALUES(TG_OP,OLD.id,to_jsonb(OLD),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(NEW) ELSE NULL END,
 CASE WHEN TG_OP='UPDATE' THEN 'source_updated' WHEN coalesce(current_setting('booking_sync.source_ids',true),'')='' THEN 'unclassified_direct_write' WHEN current_setting('booking_sync.source_ids',true)::jsonb @> to_jsonb(ARRAY[OLD.id]) THEN 'source_excluded_status' ELSE 'missing_from_complete_source' END, nullif(current_setting('booking_sync.lease_id',true),'')::uuid, nullif(current_setting('booking_sync.generation',true),'')::bigint);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION booking_private.capture_before_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bookings_recovery_before_change BEFORE UPDATE OR DELETE ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION booking_private.capture_before_change();
CREATE INDEX bookings_shop_date_idx ON public.bookings(shop_id,date);
CREATE SEQUENCE booking_private.generation_seq;
CREATE TABLE booking_private.leases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid UNIQUE NOT NULL,generation bigint UNIQUE NOT NULL DEFAULT nextval('booking_private.generation_seq'),
 shop_id text NOT NULL,date text NOT NULL,expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '120 seconds',
 committed_digest bytea,result jsonb, aborted boolean NOT NULL DEFAULT false
);
CREATE INDEX booking_leases_pending_idx ON booking_private.leases(expires_at) WHERE result IS NULL AND NOT aborted;
CREATE TABLE booking_private.pair_versions(shop_id text,date text,generation bigint NOT NULL,PRIMARY KEY(shop_id,date));
CREATE TABLE booking_private.id_versions(id bigint PRIMARY KEY,generation bigint NOT NULL);
ALTER TABLE booking_private.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_private.pair_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_private.id_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA booking_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA booking_private FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.mgj_booking_begin_v2(p_shop_id text,p_date text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l booking_private.leases; today text:=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD');
BEGIN
 IF p_shop_id NOT IN ('1009951','1837032') OR p_shop_id IS NULL OR p_date IS NULL OR p_date !~ '^\d{4}-\d{2}-\d{2}$' OR p_date<today OR p_date>to_char((today::date+7),'YYYY-MM-DD') OR to_char(p_date::date,'YYYY-MM-DD')<>p_date THEN RAISE EXCEPTION 'invalid_pair'; END IF;
 PERFORM pg_advisory_xact_lock(1790298730,2);
 -- Expired protocol receipts are metadata, not appointment/audit records.
 DELETE FROM booking_private.leases WHERE expires_at < clock_timestamp()-interval '1 day';
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
 SELECT * INTO l FROM booking_private.leases WHERE request_id=p_request_id;
 IF FOUND THEN
  IF l.shop_id<>p_shop_id OR l.date<>p_date THEN RAISE EXCEPTION 'request_id_conflict'; END IF;
  RETURN jsonb_build_object('protocol',2,'operation','begin','shop_id',p_shop_id,'date',p_date,'lease_id',l.id,'generation',l.generation,'expires_at',l.expires_at);
 END IF;
 IF EXISTS(SELECT FROM booking_private.leases WHERE result IS NULL AND NOT aborted AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'lease_busy'; END IF;
 INSERT INTO booking_private.leases(shop_id,date,request_id) VALUES(p_shop_id,p_date,p_request_id) RETURNING * INTO l;
 RETURN jsonb_build_object('protocol',2,'operation','begin','shop_id',p_shop_id,'date',p_date,'lease_id',l.id,'generation',l.generation,'expires_at',l.expires_at);
END $$;
CREATE FUNCTION public.mgj_booking_commit_v2(p_shop_id text,p_date text,p_lease_id uuid,p_bookings jsonb,p_source_complete boolean,p_source_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l booking_private.leases; r jsonb; ids bigint[]; n integer; removed integer; answer jsonb; allowed_ids bigint[]; raw_ids bigint[];
BEGIN
 IF p_source_complete IS DISTINCT FROM true OR jsonb_typeof(p_bookings) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'incomplete_source'; END IF;
 IF jsonb_array_length(p_bookings)>500 THEN RAISE EXCEPTION 'too_many_rows'; END IF;
 -- Serialize all moves as well as pair replacements. No untrusted lock keys.
 PERFORM pg_advisory_xact_lock(1790298730,2);
 SELECT * INTO l FROM booking_private.leases WHERE id=p_lease_id FOR UPDATE;
 IF NOT FOUND OR l.shop_id IS DISTINCT FROM p_shop_id OR l.date IS DISTINCT FROM p_date THEN RAISE EXCEPTION 'invalid_lease'; END IF;
 IF p_date < to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD') THEN RAISE EXCEPTION 'date_expired'; END IF;
 IF l.aborted THEN RAISE EXCEPTION 'aborted_lease'; END IF;
 IF l.result IS NOT NULL THEN
   IF l.committed_digest IS DISTINCT FROM sha256(convert_to(jsonb_build_object('bookings',p_bookings,'source_rows',p_source_rows)::text,'UTF8')) THEN RAISE EXCEPTION 'replay_payload_mismatch'; END IF;
   RETURN l.result;
 END IF;
 IF l.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'expired_lease'; END IF;
 IF EXISTS(SELECT FROM booking_private.pair_versions WHERE shop_id=p_shop_id AND date=p_date AND generation>=l.generation) THEN RAISE EXCEPTION 'stale_pair'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_bookings) LOOP
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (r->>'id') IS NULL OR (r->>'id')!~'^[1-9][0-9]*$' OR (r->>'id')::numeric>9007199254740991
    OR r->>'shop_id' IS DISTINCT FROM p_shop_id OR r->>'date' IS DISTINCT FROM p_date
    OR r->>'shop_name' IS DISTINCT FROM (CASE p_shop_id WHEN '1009951' THEN '自由手艺人' ELSE '向里造型' END)
    OR r->>'status' IS NULL OR r->>'status' NOT IN ('0','1','3','4')
    OR r->>'reservation_time' IS NULL OR r->>'reservation_time' !~ '^[0-9]+$'
    OR r->>'barber_name' IS NULL THEN RAISE EXCEPTION 'invalid_row'; END IF;
 END LOOP;
 SELECT coalesce(array_agg((value->>'id')::bigint),'{}'::bigint[]) INTO ids FROM jsonb_array_elements(p_bookings);
 IF jsonb_typeof(p_source_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_source_rows)>500 THEN RAISE EXCEPTION 'invalid_source_rows'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_source_rows) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->>'id' IS NULL OR r->>'id' !~ '^[1-9][0-9]*$' OR (r->>'id')::numeric>9007199254740991 OR r->>'status' IS NULL OR r->>'status' NOT IN ('0','1','2','3','4') OR r->>'reservation_time' IS NULL OR r->>'reservation_time' !~ '^[1-9][0-9]*$' OR (r->>'reservation_time')::numeric>9007199254740991 OR to_char(to_timestamp((r->>'reservation_time')::double precision/1000) at time zone 'Asia/Shanghai','YYYY-MM-DD')<>p_date THEN RAISE EXCEPTION 'invalid_source_row'; END IF;
 END LOOP;
 SELECT coalesce(array_agg((value->>'id')::bigint),'{}'::bigint[]) INTO raw_ids FROM jsonb_array_elements(p_source_rows);
 IF cardinality(raw_ids)<>(SELECT count(DISTINCT x) FROM unnest(raw_ids) x) THEN RAISE EXCEPTION 'duplicate_source_ids'; END IF;
 SELECT coalesce(array_agg((value->>'id')::bigint),'{}'::bigint[]) INTO allowed_ids FROM jsonb_array_elements(p_source_rows) WHERE value->>'status' IN ('0','3','4') OR (value->>'status'='1' AND p_date=to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD'));
 IF NOT(ids @> allowed_ids AND ids <@ allowed_ids) THEN RAISE EXCEPTION 'source_subset_mismatch'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_bookings) b JOIN jsonb_array_elements(p_source_rows) sr ON b->>'id'=sr->>'id' WHERE b->>'status' IS DISTINCT FROM sr->>'status' OR b->>'reservation_time' IS DISTINCT FROM sr->>'reservation_time') THEN RAISE EXCEPTION 'source_row_mismatch'; END IF;
 PERFORM set_config('booking_sync.source_ids',to_jsonb(raw_ids)::text,true);
 PERFORM set_config('booking_sync.lease_id',l.id::text,true);
 PERFORM set_config('booking_sync.generation',l.generation::text,true);
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'duplicate_ids'; END IF;
 IF EXISTS(SELECT FROM booking_private.id_versions WHERE id=ANY(ids) AND generation>l.generation) THEN RAISE EXCEPTION 'stale_id'; END IF;
 -- Defensive actual table lock also excludes legacy direct DML during this transaction.
 LOCK TABLE public.bookings IN SHARE ROW EXCLUSIVE MODE;
 INSERT INTO booking_private.id_versions(id,generation)
 SELECT b.id,l.generation FROM public.bookings b WHERE b.shop_id=p_shop_id AND b.date=p_date AND NOT(b.id=ANY(ids))
 ON CONFLICT(id) DO UPDATE SET generation=greatest(booking_private.id_versions.generation,excluded.generation);
 DELETE FROM public.bookings WHERE shop_id=p_shop_id AND date=p_date AND NOT(id=ANY(ids));
 GET DIAGNOSTICS removed=ROW_COUNT;
 INSERT INTO public.bookings(id,shop_id,shop_name,barber_name,barber_id,customer_name,customer_phone,reservation_time,time_label,date,status,updated_at,service_name,notes)
 SELECT x.id,x.shop_id,x.shop_name,x.barber_name,x.barber_id,x.customer_name,x.customer_phone,x.reservation_time,x.time_label,x.date,x.status,clock_timestamp(),x.service_name,x.notes
 FROM jsonb_populate_recordset(NULL::public.bookings,p_bookings) x
 ON CONFLICT(id) DO UPDATE SET shop_id=excluded.shop_id,shop_name=excluded.shop_name,barber_name=excluded.barber_name,barber_id=excluded.barber_id,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,reservation_time=excluded.reservation_time,time_label=excluded.time_label,date=excluded.date,status=excluded.status,updated_at=excluded.updated_at,service_name=excluded.service_name,notes=excluded.notes;
 INSERT INTO booking_private.id_versions(id,generation) SELECT x,l.generation FROM unnest(ids) x
 ON CONFLICT(id) DO UPDATE SET generation=excluded.generation;
 INSERT INTO booking_private.pair_versions VALUES(p_shop_id,p_date,l.generation)
 ON CONFLICT(shop_id,date) DO UPDATE SET generation=excluded.generation;
 answer:=jsonb_build_object('protocol',2,'shop_id',p_shop_id,'date',p_date,'operation','commit','lease_id',l.id,'generation',l.generation,'upserted',cardinality(ids),'deleted',removed);
 UPDATE booking_private.leases SET committed_digest=sha256(convert_to(jsonb_build_object('bookings',p_bookings,'source_rows',p_source_rows)::text,'UTF8')),result=answer WHERE id=p_lease_id;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.mgj_booking_begin_v2(text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mgj_booking_commit_v2(text,text,uuid,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mgj_booking_begin_v2(text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mgj_booking_commit_v2(text,text,uuid,jsonb,boolean,jsonb) TO service_role;
CREATE FUNCTION public.mgj_booking_abort_v2(p_shop_id text,p_date text,p_lease_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1790298730,2);
 UPDATE booking_private.leases SET aborted=true WHERE id=p_lease_id AND shop_id=p_shop_id AND date=p_date AND result IS NULL;
 RETURN jsonb_build_object('protocol',2,'operation','abort','shop_id',p_shop_id,'date',p_date,'lease_id',p_lease_id,'aborted',FOUND);
END $$;
REVOKE ALL ON FUNCTION public.mgj_booking_abort_v2(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mgj_booking_abort_v2(text,text,uuid) TO service_role;
-- Only authenticated RPCs may mutate the mirror; retain existing SELECT grants.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES ON public.bookings FROM service_role;
