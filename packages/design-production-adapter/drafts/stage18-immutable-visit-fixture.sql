-- OFFLINE SYNTHETIC PG17 ONLY. No production installation or implicit identity migration.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regclass('design_identity.visit_bindings') IS NULL OR to_regclass('design_key_private.key_heads') IS NULL OR to_regnamespace('design_visit_private') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_VISIT_FIXTURE_REQUIRED';END IF;
END$$;
CREATE ROLE design_visit_capability NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA design_visit_private AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_visit_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_visit_private TO design_identity_runtime,design_visit_capability;
GRANT CREATE ON SCHEMA design_visit_private TO design_visit_capability;
GRANT USAGE ON SCHEMA design_identity,design_key_private,public TO design_visit_capability;
GRANT EXECUTE ON FUNCTION design_key_private.resolve_hash(text),design_identity.resolve_hash(text,jsonb) TO design_visit_capability;
GRANT SELECT,UPDATE(visit_id) ON design_identity.visit_bindings TO design_visit_capability;
CREATE POLICY immutable_visit_read ON design_identity.visit_bindings FOR SELECT TO design_visit_capability USING(true);
CREATE POLICY immutable_visit_lock ON design_identity.visit_bindings FOR UPDATE TO design_visit_capability USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(id) ON public.customer_profiles TO design_visit_capability;
CREATE POLICY immutable_visit_profile_read ON public.customer_profiles FOR SELECT TO design_visit_capability USING(true);
CREATE POLICY immutable_visit_profile_lock ON public.customer_profiles FOR UPDATE TO design_visit_capability USING(true) WITH CHECK(false);
CREATE FUNCTION design_visit_private.check_identity(a jsonb,i jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF jsonb_build_object('subjectId',a->'subjectId','employmentId',a->'employmentId','membershipId',a->'membershipId','storeId',a->'storeId','securityEpoch',a->'securityEpoch','membershipRevision',a->'membershipRevision') IS DISTINCT FROM (i-ARRAY['schemaVersion','expiresAt']) THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_DENIED' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION design_visit_private.read_day(c text,d text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h text;i jsonb;a jsonb;sc jsonb;b design_identity.visit_bindings%rowtype;day date;n int;name text;shop text;rows jsonb:='[]';r jsonb;BEGIN
 IF session_user<>'design_identity_runtime' OR c IS NULL OR length(c) NOT BETWEEN 32 AND 200 OR c ~ '[[:space:][:cntrl:]]' OR d IS NULL OR d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR d LIKE '0000-%' THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_INVALID';END IF;
 day:=d::date;IF to_char(day,'YYYY-MM-DD')<>d THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));h:=encode(sha256(convert_to(c,'UTF8')),'hex');i:=design_key_private.resolve_hash(h);
 SELECT count(*) INTO n FROM design_identity.visit_bindings WHERE membership_id=i->>'membershipId' AND store_id=i->>'storeId' AND active AND business_date=day;
 IF n>50 THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_LIMIT';END IF;
 FOR b IN SELECT * FROM design_identity.visit_bindings WHERE membership_id=i->>'membershipId' AND store_id=i->>'storeId' AND active AND business_date=day ORDER BY assignment_source COLLATE "C",visit_id COLLATE "C" FOR SHARE LOOP
  sc:=jsonb_build_object('customerProfileId',b.customer_profile_id::text,'visitId',b.visit_id,'assignmentSource',b.assignment_source);
  a:=design_identity.resolve_hash(h,sc)->'authority';PERFORM design_visit_private.check_identity(a,i);
  SELECT p.name,p.shop_name INTO STRICT name,shop FROM public.customer_profiles p WHERE p.id=b.customer_profile_id FOR SHARE;
  IF name IS NULL OR length(name) NOT BETWEEN 1 AND 160 OR name<>btrim(name) OR name ~ '[[:cntrl:]]' OR shop IS DISTINCT FROM a->'actor'->>'store' THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_INVALID';END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('authority',a,'displayName',name));
 END LOOP;
 IF jsonb_array_length(rows)<>n THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_CHANGED';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP IF design_identity.resolve_hash(h,r->'authority'->'scope')->'authority' IS DISTINCT FROM r->'authority' THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_CHANGED';END IF;END LOOP;
 IF design_key_private.resolve_hash(h) IS DISTINCT FROM i THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_CHANGED';END IF;
 RETURN jsonb_build_object('identity',i,'date',d,'rows',rows);
END$$;
CREATE FUNCTION design_visit_private.resolve_visit(c text,v jsonb,expected text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h text;i jsonb;a jsonb;sc jsonb;b design_identity.visit_bindings%rowtype;BEGIN
 IF session_user<>'design_identity_runtime' OR c IS NULL OR length(c) NOT BETWEEN 32 AND 200 OR c ~ '[[:space:][:cntrl:]]' OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>2 OR (v-ARRAY['assignmentSource','visitId'])<>'{}' OR v->>'assignmentSource' NOT IN ('appointment','frontdesk') OR v->>'visitId' IS NULL OR (expected IS NOT NULL AND expected !~ '^[1-9][0-9]{0,15}$') THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));h:=encode(sha256(convert_to(c,'UTF8')),'hex');i:=design_key_private.resolve_hash(h);
 SELECT * INTO STRICT b FROM design_identity.visit_bindings WHERE assignment_source=v->>'assignmentSource' AND visit_id=v->>'visitId' FOR SHARE;
 IF NOT b.active OR b.membership_id IS DISTINCT FROM i->>'membershipId' OR b.store_id IS DISTINCT FROM i->>'storeId' OR (expected IS NOT NULL AND b.binding_revision::text<>expected) THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_DENIED' USING ERRCODE='42501';END IF;
 sc:=jsonb_build_object('customerProfileId',b.customer_profile_id::text,'visitId',b.visit_id,'assignmentSource',b.assignment_source);a:=design_identity.resolve_hash(h,sc)->'authority';PERFORM design_visit_private.check_identity(a,i);
 IF design_key_private.resolve_hash(h) IS DISTINCT FROM i OR design_identity.resolve_hash(h,sc)->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'IMMUTABLE_VISIT_CHANGED';END IF;
 RETURN jsonb_build_object('identity',i,'authority',a);
END$$;
ALTER FUNCTION design_visit_private.check_identity(jsonb,jsonb) OWNER TO design_visit_capability;
ALTER FUNCTION design_visit_private.read_day(text,text) OWNER TO design_visit_capability;
ALTER FUNCTION design_visit_private.resolve_visit(text,jsonb,text) OWNER TO design_visit_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_visit_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION design_visit_private.read_day(text,text),design_visit_private.resolve_visit(text,jsonb,text) TO design_identity_runtime;
REVOKE CREATE ON SCHEMA design_visit_private FROM design_visit_capability;
