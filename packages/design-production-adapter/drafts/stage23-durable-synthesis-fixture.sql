-- ISOLATED SYNTHETIC PG17 ONLY. Not an installed migration, worker deployment,
-- production grant, provider exactly-once guarantee or absolute COMMIT deadline.
DO $$BEGIN IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regnamespace('design_candidate_provider_binding') IS NULL OR to_regnamespace('design_durable_synthesis') IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC_DURABLE_REQUIRED';END IF;END$$;
CREATE ROLE design_synthesis_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE design_executor_synthetic TO design_synthesis_worker;
CREATE SCHEMA design_durable_synthesis AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_durable_synthesis FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_durable_synthesis TO design_identity_capability,design_identity_runtime,design_synthesis_worker;
GRANT CREATE ON SCHEMA design_durable_synthesis TO design_identity_capability;
CREATE TABLE design_durable_synthesis.jobs(
 operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{64}$'),authority jsonb NOT NULL,intent jsonb NOT NULL,
 session_hash text NOT NULL REFERENCES design_identity.sessions(session_hash),side text NOT NULL CHECK(side IN ('left','right')),
 state text NOT NULL CHECK(state IN ('queued','leased','dispatch_claimed','completed','uncertain','not_sent','cancelled')),
 revision bigint NOT NULL CHECK(revision>0),fence bigint NOT NULL CHECK(fence>=0),lease_until timestamptz,
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 cancel_requested boolean NOT NULL DEFAULT false,candidate_id text,terminal_reason text CHECK(terminal_reason IS NULL OR terminal_reason='pre_dispatch_authority_unavailable'));
CREATE TABLE design_durable_synthesis.contexts(session_login name NOT NULL,backend_pid integer NOT NULL,transaction_id bigint NOT NULL,operation_id text NOT NULL REFERENCES design_durable_synthesis.jobs(operation_id),fence bigint NOT NULL,action text NOT NULL CHECK(action IN ('enqueue','claim','recheck','dispatch','finish','fail','cancel')),PRIMARY KEY(session_login,backend_pid,transaction_id));
CREATE TABLE design_durable_synthesis.events(operation_id text NOT NULL REFERENCES design_durable_synthesis.jobs(operation_id),revision bigint NOT NULL,state text NOT NULL,fence bigint NOT NULL,cancel_requested boolean NOT NULL,created_at timestamptz NOT NULL,reason text NOT NULL CHECK(reason IN ('state_transition','pre_dispatch_authority_unavailable')),PRIMARY KEY(operation_id,revision));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['jobs','contexts','events'] LOOP
 EXECUTE format('ALTER TABLE design_durable_synthesis.%I OWNER TO design_identity_owner',t);EXECUTE format('ALTER TABLE design_durable_synthesis.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE design_durable_synthesis.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY capability_only ON design_durable_synthesis.%I TO design_identity_capability USING(true) WITH CHECK(true)',t);END LOOP;END$$;
GRANT SELECT,INSERT,UPDATE ON design_durable_synthesis.jobs TO design_identity_capability;
GRANT SELECT,INSERT,DELETE ON design_durable_synthesis.contexts TO design_identity_capability;
GRANT SELECT,INSERT ON design_durable_synthesis.events TO design_identity_capability;
-- All private helpers derive authority from a protected job. The LOGIN worker
-- receives no direct table privileges, no existing generic runtime capabilities.
CREATE FUNCTION design_durable_synthesis.lock_all() RETURNS void LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) $$;
CREATE FUNCTION design_durable_synthesis.guard_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','revision','fence','lease_until','updated_at','cancel_requested','candidate_id','terminal_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','fence','lease_until','updated_at','cancel_requested','candidate_id','terminal_reason']) OR NEW.revision<>OLD.revision+1 OR NEW.fence<OLD.fence OR OLD.cancel_requested AND NOT NEW.cancel_requested) THEN RAISE EXCEPTION 'DURABLE_IMMUTABLE' USING ERRCODE='42501';END IF;
 RETURN NEW;END$$;
CREATE TRIGGER durable_job_immutable BEFORE UPDATE ON design_durable_synthesis.jobs FOR EACH ROW EXECUTE FUNCTION design_durable_synthesis.guard_job();
CREATE FUNCTION design_durable_synthesis.audit_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN INSERT INTO design_durable_synthesis.events VALUES(NEW.operation_id,NEW.revision,NEW.state,NEW.fence,NEW.cancel_requested,clock_timestamp(),coalesce(NEW.terminal_reason,'state_transition'));RETURN NEW;END$$;
CREATE TRIGGER durable_job_audit AFTER INSERT OR UPDATE ON design_durable_synthesis.jobs FOR EACH ROW EXECUTE FUNCTION design_durable_synthesis.audit_job();
CREATE FUNCTION design_durable_synthesis.bind_context(j design_durable_synthesis.jobs,action_name text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 DELETE FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid();
 INSERT INTO design_durable_synthesis.contexts VALUES(session_user,pg_backend_pid(),txid_current(),j.operation_id,j.fence,action_name);
END$$;
CREATE FUNCTION design_durable_synthesis.clear_private() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 DELETE FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF session_user='design_identity_runtime' THEN PERFORM design_identity.clear_context();END IF;
END$$;
CREATE FUNCTION design_durable_synthesis.require_worker_authority() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c design_durable_synthesis.contexts%rowtype;j design_durable_synthesis.jobs%rowtype;r jsonb;BEGIN
 IF session_user<>'design_synthesis_worker' THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT c FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 SELECT * INTO STRICT j FROM design_durable_synthesis.jobs WHERE operation_id=c.operation_id FOR UPDATE;
 IF j.fence<>c.fence OR j.expires_at<=clock_timestamp() OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() OR j.cancel_requested OR j.state NOT IN ('leased','dispatch_claimed','completed') THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 r:=design_identity.resolve_hash(j.session_hash,j.authority->'scope');
 IF r->'authority' IS DISTINCT FROM j.authority OR (r->>'expiresAt')::timestamptz<=clock_timestamp() OR j.expires_at<=clock_timestamp() OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 RETURN j.authority;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END$$;
DO $guard$DECLARE source text;definition text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO STRICT source,definition FROM pg_proc WHERE oid='design_identity.require_authority()'::regprocedure;IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'b564f967963f99aa41b0129f67f0a47fc9cb4af1aa019fbd7448bb14de33598f' THEN RAISE EXCEPTION 'DURABLE_PREDECESSOR_CHANGED';END IF;EXECUTE replace(definition,$old$if session_user<>'design_identity_runtime' then raise exception 'IDENTITY_CONTEXT_REQUIRED' using errcode='42501'; end if;$old$,$new$if session_user='design_synthesis_worker' then return design_durable_synthesis.require_worker_authority(); end if;
  if session_user<>'design_identity_runtime' then raise exception 'IDENTITY_CONTEXT_REQUIRED' using errcode='42501'; end if;$new$);END$guard$;
DO $guard$DECLARE source text;definition text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO STRICT source,definition FROM pg_proc WHERE oid='design_candidate_provider_binding.assert_candidate_namespace(jsonb,text,text)'::regprocedure;IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'d205a7a2f7dd1a94424ee742184ec35fc29b995e96244fd589479ad9e02b310d' THEN RAISE EXCEPTION 'DURABLE_PREDECESSOR_CHANGED';END IF;EXECUTE replace(definition,$old$session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer')$old$,$new$session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer','design_synthesis_worker')$new$);END$guard$;
DO $guard$DECLARE source text;definition text;BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO STRICT source,definition FROM pg_proc WHERE oid='design_candidate_provider_binding.context_for(jsonb,text,text,text,jsonb)'::regprocedure;IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'93a6f6c5ef52ec5423616dac23e7cc8777a5d089724fd489021bd52c279b5c6c' THEN RAISE EXCEPTION 'DURABLE_PREDECESSOR_CHANGED';END IF;EXECUTE replace(definition,$old$session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer')$old$,$new$session_user NOT IN ('design_identity_runtime','design_provider_approval_issuer','design_synthesis_worker')$new$);END$guard$;
-- Queue ownership also constrains callers using the OLD fixed ledger functions.
-- No GUC can authorize this trigger; only an unexposed protected transaction row.
CREATE FUNCTION design_durable_synthesis.guard_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;c design_durable_synthesis.contexts%rowtype;BEGIN
 SELECT * INTO j FROM design_durable_synthesis.jobs WHERE operation_id=NEW.owner_key FOR UPDATE;IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.record->'authority' IS DISTINCT FROM j.authority OR NEW.record->'intent' IS DISTINCT FROM j.intent THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 -- Independent runtime revocation remains permitted; it never grants dispatch.
 IF TG_TABLE_NAME='approvals' AND TG_OP='UPDATE' AND NEW.record->'active'='false'::jsonb THEN RETURN NEW;END IF;
 SELECT * INTO c FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND operation_id=j.operation_id AND fence=j.fence;
 IF c.operation_id IS NULL THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='approvals' THEN
  IF NOT (c.action='enqueue' AND TG_OP='INSERT' AND session_user='design_identity_runtime' OR c.action='dispatch' AND TG_OP='UPDATE' AND session_user='design_synthesis_worker') THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 ELSIF NOT (c.action='enqueue' AND TG_OP='INSERT' AND NEW.record->>'state'='pending' AND session_user='design_identity_runtime'
 OR c.action='cancel' AND TG_OP='UPDATE' AND NEW.record->>'state'='not_sent' AND session_user='design_identity_runtime'
 OR c.action='dispatch' AND TG_OP='UPDATE' AND NEW.record->>'state'='dispatch_claimed' AND session_user='design_synthesis_worker'
 OR c.action='finish' AND TG_OP='UPDATE' AND NEW.record->>'state'='completed' AND session_user='design_synthesis_worker'
 OR c.action='fail' AND TG_OP='UPDATE' AND NEW.record->>'state' IN ('uncertain','not_sent') AND session_user='design_synthesis_worker') THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER a_durable_attempt_guard BEFORE INSERT OR UPDATE ON design_policy_private.attempts FOR EACH ROW EXECUTE FUNCTION design_durable_synthesis.guard_ledger();
CREATE TRIGGER a_durable_approval_guard BEFORE INSERT OR UPDATE ON design_policy_private.approvals FOR EACH ROW EXECUTE FUNCTION design_durable_synthesis.guard_ledger();
CREATE FUNCTION design_durable_synthesis.dto(j design_durable_synthesis.jobs,available boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schemaVersion','design-synthesis-operation-v1','id',j.operation_id,'requestId',j.intent->'requestId','side',j.side,'state',j.state,'revision',j.revision,'createdAt',floor(extract(epoch FROM j.created_at)*1000)::bigint,'updatedAt',floor(extract(epoch FROM j.updated_at)*1000)::bigint,'expiresAt',floor(extract(epoch FROM j.expires_at)*1000)::bigint,'sourceBinding',j.intent->'sourceBinding','candidateId',CASE WHEN available THEN j.candidate_id ELSE NULL END,'resultAvailable',available,'cancelRequested',j.cancel_requested)
$$;
CREATE FUNCTION design_durable_synthesis.result_available(j design_durable_synthesis.jobs) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r jsonb;b jsonb;c jsonb;a jsonb;BEGIN
 IF j.state<>'completed' OR j.cancel_requested OR j.candidate_id IS NULL OR j.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 b:=design_dependency_authority.checked_bundle(j.authority);
 SELECT value INTO c FROM jsonb_array_elements(b->'candidateRows') x WHERE x->>'candidate_id'=j.candidate_id;
 SELECT value INTO a FROM jsonb_array_elements(b->'dependencyAuthors') x WHERE x->>'kind'='candidate' AND x->>'id'=j.candidate_id;
 IF c IS NULL OR c->'active' IS DISTINCT FROM 'true'::jsonb OR c->'consumed' IS DISTINCT FROM 'null'::jsonb OR (c->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) OR a->'authority' IS DISTINCT FROM j.authority OR a->'sha256' IS DISTINCT FROM c->'sha256' THEN RETURN false;END IF;
 r:=design_policy_private.read_attempt(j.operation_id);
 RETURN r IS NOT NULL AND r->>'state'='completed' AND r->'result'->'candidateEnvelope' IS NOT DISTINCT FROM c->'envelope';
EXCEPTION WHEN sqlstate '42501' THEN RETURN false;END$$;
-- Metadata reads still recheck the original source/key/evidence facts. No JS history
-- replay or cost/key details are returned. Expired consent cannot authorize result delivery.
CREATE FUNCTION design_durable_synthesis.check_source(j design_durable_synthesis.jobs) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b jsonb;w jsonb;r jsonb;sb jsonb;BEGIN
 b:=design_dependency_authority.checked_bundle(j.authority);w:=b->'workflowRows'->-1;r:=w->'record';
 sb:=jsonb_build_object('workflowRevision',w->'revision','workflowSha256',w->'sha256','sessionId',r->'session'->'scope'->'sessionId','sessionRevision',r->'session'->'revision','sessionDigest',design_dependency_authority.digest(r->'session'),'manifestId',b->'manifest'->'id','manifestFingerprint',b->'manifest'->'sourceFingerprint');
 IF sb IS DISTINCT FROM j.intent->'sourceBinding' THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_candidate_provider_binding.check_evidence(b,r,'completion_synthesis',j.intent->>'kind',j.intent->'evidenceBinding');
END$$;
CREATE FUNCTION design_durable_synthesis.status(credential text,scope jsonb,operation_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;j design_durable_synthesis.jobs%rowtype;v jsonb;BEGIN
 PERFORM design_durable_synthesis.lock_all();a:=design_identity.authorize(credential,scope);
 SELECT * INTO j FROM design_durable_synthesis.jobs x WHERE x.operation_id=status.operation_id AND x.authority=a;
 IF j.operation_id IS NOT NULL THEN PERFORM design_durable_synthesis.check_source(j);END IF;
 v:=CASE WHEN j.operation_id IS NULL THEN NULL ELSE design_durable_synthesis.dto(j,design_durable_synthesis.result_available(j)) END;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operation',v);
END$$;
CREATE FUNCTION design_durable_synthesis.lookup(credential text,scope jsonb,request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;k text;BEGIN
 PERFORM design_durable_synthesis.lock_all();a:=design_identity.authorize(credential,scope);
 IF request_id IS NULL OR request_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'DURABLE_INVALID' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',request_id));
 RETURN design_durable_synthesis.status(credential,scope,k);
END$$;
CREATE FUNCTION design_durable_synthesis.list(credential text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;j design_durable_synthesis.jobs%rowtype;v jsonb:='[]';scanned integer:=0;BEGIN
 PERFORM design_durable_synthesis.lock_all();a:=design_identity.authorize(credential,scope);
 FOR j IN SELECT * FROM design_durable_synthesis.jobs WHERE authority=a ORDER BY created_at DESC,operation_id LIMIT 21 LOOP
  scanned:=scanned+1;IF scanned>20 THEN RAISE EXCEPTION 'DURABLE_CAPACITY' USING ERRCODE='42501';END IF;
  BEGIN PERFORM design_durable_synthesis.check_source(j);EXCEPTION WHEN sqlstate '42501' THEN IF SQLERRM='DURABLE_DENIED' THEN CONTINUE;ELSE RAISE;END IF;END;
  v:=v||jsonb_build_array(design_durable_synthesis.dto(j,design_durable_synthesis.result_available(j)));
 END LOOP;
 IF jsonb_array_length(v)>20 THEN RAISE EXCEPTION 'DURABLE_CAPACITY' USING ERRCODE='42501';END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operations',v);
END$$;
CREATE FUNCTION design_durable_synthesis.enqueue(credential text,scope jsonb,request_id text,side text,intent jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;k text;lk text;lf text;j design_durable_synthesis.jobs%rowtype;ctx design_identity.transaction_contexts%rowtype;p jsonb;old jsonb;n jsonb;t timestamptz:=clock_timestamp();deadline timestamptz;ms bigint;BEGIN
 PERFORM design_durable_synthesis.lock_all();a:=design_identity.authorize(credential,scope);
 IF request_id IS NULL OR request_id !~ '^[A-Za-z0-9_-]{1,80}$' OR side IS NULL OR side NOT IN ('left','right') OR design_candidate_provider_binding.valid_intent(intent) IS DISTINCT FROM true OR intent->>'candidateKind' IS DISTINCT FROM 'completion_synthesis' OR intent->>'requestId' IS DISTINCT FROM request_id OR intent->'evidenceBinding'->'synthesis'->>'side' IS DISTINCT FROM side THEN RAISE EXCEPTION 'DURABLE_INVALID' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'subjectId',a->'employmentId',a->'membershipId',a->'storeId',request_id));
 SELECT * INTO j FROM design_durable_synthesis.jobs WHERE operation_id=k FOR UPDATE;
 IF FOUND THEN IF j.authority IS DISTINCT FROM a OR j.intent IS DISTINCT FROM intent OR j.side IS DISTINCT FROM side THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;RETURN design_durable_synthesis.status(credential,scope,k);END IF;
 IF EXISTS(SELECT 1 FROM design_policy_private.attempts WHERE owner_key=k) THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM design_durable_synthesis.jobs WHERE state IN ('queued','leased','dispatch_claimed') AND NOT cancel_requested AND expires_at>clock_timestamp())>=32 OR EXISTS(SELECT 1 FROM design_durable_synthesis.jobs WHERE (authority-ARRAY['scope','bindingRevision'])=(a-ARRAY['scope','bindingRevision']) AND state IN ('queued','leased','dispatch_claimed') AND NOT cancel_requested AND expires_at>clock_timestamp()) OR (SELECT count(*) FROM design_durable_synthesis.jobs WHERE authority=a)>=20 THEN RAISE EXCEPTION 'DURABLE_CAPACITY' USING ERRCODE='42501';END IF;
 IF intent->>'kind'='local' THEN PERFORM design_candidate_provider_binding.register_local(intent);ELSE
  p:=design_candidate_provider_binding.read_issued(request_id);IF p->'authority' IS DISTINCT FROM a OR p->'intent' IS DISTINCT FROM intent THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
  p:=p||jsonb_build_object('schemaVersion','design-provider-approval-v1','ownerKey',k,'revision',1,'active',true,'consumedBy',NULL);
 END IF;
 IF design_candidate_provider_binding.verify_request_context(a,intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT ctx FROM design_identity.transaction_contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 deadline:=least(ctx.expires_at,t+interval '5 minutes',CASE WHEN p IS NULL THEN ctx.expires_at ELSE to_timestamp((p->>'expiresAt')::numeric/1000) END);
 IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 INSERT INTO design_durable_synthesis.jobs VALUES(k,a,intent,ctx.session_hash,side,'queued',1,0,NULL,t,t,deadline,false,NULL,NULL) RETURNING * INTO j;
 PERFORM design_durable_synthesis.bind_context(j,'enqueue');
 IF p IS NOT NULL THEN
  old:=design_policy_private.read_approval(k);IF old IS NULL THEN IF design_policy_private.insert_approval(k,p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;ELSIF old IS DISTINCT FROM p THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 END IF;
 ms:=floor(extract(epoch FROM t)*1000)::bigint;lk:=design_dependency_authority.digest(jsonb_build_array(a->'actor',request_id));lf:=design_dependency_authority.digest(jsonb_build_object('scope',scope,'operation',intent->'operation','model',intent->'model','endpoint',intent->'destination','payloadSha256',intent->'payloadSha256'));
 n:=jsonb_build_object('schemaVersion','design-provider-attempt-v1','ownerKey',k,'revision',1,'authority',a,'intent',intent,'legacyKey',lk,'legacyFingerprint',lf,'approvalReceiptId',p->'receiptId','state','pending','result',NULL,'createdAt',ms,'updatedAt',ms);
 IF design_policy_private.insert_attempt(k,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a OR design_candidate_provider_binding.verify_request_context(a,intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operation',design_durable_synthesis.dto(j));
END$$;
CREATE FUNCTION design_durable_synthesis.cancel(credential text,scope jsonb,operation_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;j design_durable_synthesis.jobs%rowtype;r jsonb;n jsonb;BEGIN
 PERFORM design_durable_synthesis.lock_all();a:=design_identity.authorize(credential,scope);
 SELECT * INTO j FROM design_durable_synthesis.jobs x WHERE x.operation_id=cancel.operation_id AND x.authority=a FOR UPDATE;
 IF NOT FOUND THEN PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operation',NULL);END IF;
 -- Cancellation only reduces rights. Current exact owner/scope authority above
 -- suffices; stale source or revoked key must not prevent a stop request.
 IF NOT j.cancel_requested THEN
  PERFORM design_durable_synthesis.bind_context(j,'cancel');
  IF j.state IN ('queued','leased') THEN r:=design_policy_private.read_attempt(j.operation_id);IF r->>'state' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
   n:=r||jsonb_build_object('revision',(r->>'revision')::bigint+1,'state','not_sent','result',NULL,'updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
   IF design_policy_private.cas_attempt(j.operation_id,(r->>'revision')::bigint,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
  END IF;
  UPDATE design_durable_synthesis.jobs SET cancel_requested=true,state=CASE WHEN state IN ('queued','leased') THEN 'cancelled' ELSE state END,revision=revision+1,updated_at=clock_timestamp() WHERE jobs.operation_id=j.operation_id RETURNING * INTO j;
 END IF;
 IF design_identity.require_authority() IS DISTINCT FROM a THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operation',design_durable_synthesis.dto(j));
END$$;
CREATE FUNCTION design_durable_synthesis.lease_dto(j design_durable_synthesis.jobs) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('operationId',j.operation_id,'fence',j.fence,'leaseExpiresAt',floor(extract(epoch FROM j.lease_until)*1000)::bigint,'authority',j.authority,'intent',j.intent) $$;
CREATE FUNCTION design_durable_synthesis.worker_job(id text,expected_fence bigint,action_name text) RETURNS design_durable_synthesis.jobs LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;BEGIN
 IF session_user<>'design_synthesis_worker' OR id IS NULL OR id !~ '^[a-f0-9]{64}$' OR expected_fence IS NULL OR expected_fence<1 THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.lock_all();SELECT * INTO STRICT j FROM design_durable_synthesis.jobs WHERE operation_id=id FOR UPDATE;
 IF j.fence<>expected_fence THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.bind_context(j,action_name);PERFORM design_durable_synthesis.require_worker_authority();RETURN j;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END$$;
CREATE FUNCTION design_durable_synthesis.check_live(j design_durable_synthesis.jobs) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;BEGIN
 IF design_candidate_provider_binding.verify_request_context(j.authority,j.intent) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 IF j.intent->>'kind'='external' THEN
  p:=design_policy_private.read_approval(j.operation_id);IF p IS NULL OR p->'authority' IS DISTINCT FROM j.authority OR p->'intent' IS DISTINCT FROM j.intent OR p->'active' IS DISTINCT FROM 'true'::jsonb OR (p->>'expiresAt')::numeric<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 END IF;
 PERFORM design_durable_synthesis.require_worker_authority();
END$$;
CREATE FUNCTION design_durable_synthesis.claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;r jsonb;n integer;BEGIN
 IF session_user<>'design_synthesis_worker' THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.lock_all();
 -- Bounded pre-dispatch invalidation: audit fixed reason, retain original pending
 -- ledger tombstone. It is NOT a billed result/ledger settlement or permission to resend.
 FOR n IN 1..8 LOOP
  SELECT * INTO j FROM design_durable_synthesis.jobs WHERE NOT cancel_requested AND expires_at>clock_timestamp() AND (state='queued' OR state='leased' AND lease_until<=clock_timestamp()) ORDER BY created_at,operation_id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL;END IF;
  BEGIN
   UPDATE design_durable_synthesis.jobs SET state='leased',revision=revision+1,fence=fence+1,lease_until=least(expires_at,clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp() WHERE operation_id=j.operation_id RETURNING * INTO j;
   PERFORM design_durable_synthesis.bind_context(j,'claim');PERFORM design_durable_synthesis.check_live(j);
   r:=design_policy_private.read_attempt(j.operation_id);IF r->>'state' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
  EXCEPTION WHEN sqlstate '42501' THEN
   UPDATE design_durable_synthesis.jobs SET state='not_sent',terminal_reason='pre_dispatch_authority_unavailable',revision=revision+1,updated_at=clock_timestamp() WHERE operation_id=j.operation_id;
   CONTINUE;
  END;
  PERFORM design_durable_synthesis.clear_private();RETURN design_durable_synthesis.lease_dto(j);
 END LOOP;
 PERFORM design_durable_synthesis.clear_private();RETURN NULL;
END$$;
CREATE FUNCTION design_durable_synthesis.recheck(id text,expected_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;BEGIN
 j:=design_durable_synthesis.worker_job(id,expected_fence,'recheck');PERFORM design_durable_synthesis.check_live(j);
 IF j.state NOT IN ('leased','dispatch_claimed') THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 UPDATE design_durable_synthesis.jobs SET revision=revision+1,lease_until=least(expires_at,clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp() WHERE operation_id=j.operation_id RETURNING * INTO j;
 PERFORM design_durable_synthesis.require_worker_authority();PERFORM design_durable_synthesis.clear_private();RETURN design_durable_synthesis.lease_dto(j);
END$$;
CREATE FUNCTION design_durable_synthesis.dispatch(id text,expected_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;p jsonb;r jsonb;n jsonb;BEGIN
 j:=design_durable_synthesis.worker_job(id,expected_fence,'dispatch');PERFORM design_durable_synthesis.check_live(j);
 IF j.state<>'leased' OR j.intent->>'kind' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 p:=design_policy_private.read_approval(id);r:=design_policy_private.read_attempt(id);
 IF p->'consumedBy' IS DISTINCT FROM 'null'::jsonb OR r->>'state' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 n:=p||jsonb_build_object('revision',(p->>'revision')::bigint+1,'consumedBy',id);IF design_policy_private.cas_approval(id,(p->>'revision')::bigint,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 n:=r||jsonb_build_object('revision',(r->>'revision')::bigint+1,'state','dispatch_claimed','updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);IF design_policy_private.cas_attempt(id,(r->>'revision')::bigint,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 UPDATE design_durable_synthesis.jobs SET state='dispatch_claimed',revision=revision+1,updated_at=clock_timestamp() WHERE operation_id=id RETURNING * INTO j;
 PERFORM design_durable_synthesis.check_live(j);PERFORM design_durable_synthesis.clear_private();RETURN true;
END$$;
CREATE FUNCTION design_durable_synthesis.finish(id text,expected_fence bigint,candidate jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;r jsonb;n jsonb;b jsonb;result jsonb;cid text;BEGIN
 j:=design_durable_synthesis.worker_job(id,expected_fence,'finish');PERFORM design_durable_synthesis.check_live(j);r:=design_policy_private.read_attempt(id);
 IF j.state='completed' THEN
  IF r->>'state' IS DISTINCT FROM 'completed' OR r->'result'->'candidateEnvelope' IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
  b:=design_dependency_authority.checked_bundle(j.authority);result:=jsonb_build_object('operation',design_durable_synthesis.dto(j,design_durable_synthesis.result_available(j)),'validationRecord',b->'workflowRows'->-1->'record');PERFORM design_durable_synthesis.clear_private();RETURN result;
 END IF;
 IF (j.intent->>'kind'='local' AND (j.state<>'leased' OR r->>'state'<>'pending')) OR (j.intent->>'kind'='external' AND (j.state<>'dispatch_claimed' OR r->>'state'<>'dispatch_claimed')) THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 cid:=design_dependency_authority.digest(jsonb_build_array(j.authority->'actor',j.intent->'requestId','completion_synthesis'));
 IF candidate->>'id' IS DISTINCT FROM cid OR candidate->>'kind' IS DISTINCT FROM 'completion_synthesis' OR candidate->'scope' IS DISTINCT FROM j.authority->'scope' OR candidate->'actor' IS DISTINCT FROM j.authority->'actor' OR candidate->'payloadDigest' IS DISTINCT FROM j.intent->'payloadSha256' OR candidate->'model' IS DISTINCT FROM j.intent->'model' OR candidate->'inputDigest' IS DISTINCT FROM j.intent->'inputDigest' OR candidate->'sourceRefs' IS DISTINCT FROM j.intent->'sourceRefs' OR ((candidate->'synthesis')-'reviewFocus') IS DISTINCT FROM ((j.intent->'evidenceBinding'->'synthesis')-'reviewFocus') THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 b:=design_dependency_authority.read_bundle();PERFORM design_candidate_provider_binding.synthesis_evidence(b,b->'workflowRows'->-1->'record',candidate->'synthesis');
 -- Same exact original runner result schema; never replace a result with a bare envelope.
 result:=jsonb_build_object('candidateEnvelope',candidate);
 IF j.intent->>'kind'='external' THEN result:=result||jsonb_build_object('requestId',j.intent->'requestId','provider','deepseek','operation','analyze','actor',j.authority->'actor','scope',j.authority->'scope','payloadSha256',j.intent->'payloadSha256','requiresReview',true);END IF;
 n:=r||jsonb_build_object('revision',(r->>'revision')::bigint+1,'state','completed','result',result,'updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
 IF design_policy_private.cas_attempt(id,(r->>'revision')::bigint,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 IF design_dependency_authority.publish_candidate(jsonb_build_object('expectedSourceFingerprint',b->'sourceFingerprint','candidate',candidate,'candidateSha256',design_dependency_authority.digest(candidate),'ttlMs',60000)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 UPDATE design_durable_synthesis.jobs SET state='completed',revision=revision+1,candidate_id=cid,updated_at=clock_timestamp() WHERE operation_id=id RETURNING * INTO j;
 PERFORM design_durable_synthesis.check_live(j);result:=jsonb_build_object('operation',design_durable_synthesis.dto(j,design_durable_synthesis.result_available(j)),'validationRecord',b->'workflowRows'->-1->'record');PERFORM design_durable_synthesis.clear_private();RETURN result;
END$$;
CREATE FUNCTION design_durable_synthesis.fail(id text,expected_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;r jsonb;n jsonb;s text;BEGIN
 j:=design_durable_synthesis.worker_job(id,expected_fence,'fail');r:=design_policy_private.read_attempt(id);
 IF j.state NOT IN ('leased','dispatch_claimed') OR r->>'state' NOT IN ('pending','dispatch_claimed') THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 s:=CASE WHEN r->>'state'='pending' THEN 'not_sent' ELSE 'uncertain' END;
 n:=r||jsonb_build_object('revision',(r->>'revision')::bigint+1,'state',s,'result',NULL,'updatedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
 IF design_policy_private.cas_attempt(id,(r->>'revision')::bigint,n) IS DISTINCT FROM true THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 UPDATE design_durable_synthesis.jobs SET state=s,revision=revision+1,updated_at=clock_timestamp() WHERE operation_id=id RETURNING * INTO j;
 PERFORM design_durable_synthesis.clear_private();RETURN jsonb_build_object('operation',design_durable_synthesis.dto(j));
END$$;
-- An old publish_candidate path may not create a candidate for a queued/cancelled job.
CREATE FUNCTION design_durable_synthesis.guard_candidate_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;c design_durable_synthesis.contexts%rowtype;BEGIN
 SELECT * INTO j FROM design_durable_synthesis.jobs WHERE design_dependency_authority.digest(jsonb_build_array(authority->'actor',intent->'requestId','completion_synthesis'))=NEW.candidate_id;
 IF FOUND THEN
  SELECT * INTO c FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND operation_id=j.operation_id AND fence=j.fence AND action='finish';
  IF session_user<>'design_synthesis_worker' OR c.operation_id IS NULL OR j.cancel_requested OR j.state NOT IN ('leased','dispatch_claimed') THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
  PERFORM design_durable_synthesis.require_worker_authority();
 END IF;RETURN NEW;END$$;
CREATE TRIGGER durable_candidate_publication BEFORE INSERT ON design_private.model_candidates FOR EACH ROW EXECUTE FUNCTION design_durable_synthesis.guard_candidate_publication();
-- Restrictive legacy reader policy: cancelling delivery does not erase the old
-- result, but the old synchronous ledger reader may no longer return it.
-- Independent already-published artifact access has its own revoke/expiry rules.
CREATE FUNCTION design_durable_synthesis.completed_delivery_allowed(k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;BEGIN
 SELECT * INTO j FROM design_durable_synthesis.jobs WHERE operation_id=k;
 IF NOT FOUND THEN RETURN true;END IF;
 -- PostgreSQL applies this SELECT policy to the UPDATE's new completed row.
 -- The atomic finish has not updated job.state yet. Only its protected private
 -- worker context may see that intermediate row; no runtime reader gets it.
 IF session_user='design_synthesis_worker' AND j.state IN ('leased','dispatch_claimed') AND EXISTS(
  SELECT 1 FROM design_durable_synthesis.contexts WHERE session_login=session_user AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND operation_id=k AND fence=j.fence AND action='finish') THEN
  RETURN design_durable_synthesis.require_worker_authority()=j.authority;
 END IF;
 RETURN j.state='completed' AND NOT j.cancel_requested AND j.expires_at>clock_timestamp();
END$$;
CREATE POLICY durable_completed_delivery ON design_policy_private.attempts AS RESTRICTIVE FOR SELECT TO design_identity_capability USING(CASE WHEN record->>'state'='completed' THEN design_durable_synthesis.completed_delivery_allowed(owner_key) ELSE true END);
-- Private helper rights only. Worker LOGIN never acquires these EXECUTEs.
GRANT EXECUTE ON FUNCTION design_candidate_provider_binding.register_local(jsonb) TO design_identity_capability;
GRANT EXECUTE ON FUNCTION design_dependency_authority.read_bundle(),design_dependency_authority.publish_candidate(jsonb) TO design_identity_capability;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='design_durable_synthesis' LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO design_identity_capability',f.sig);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,design_identity_runtime,design_synthesis_worker',f.sig);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION design_durable_synthesis.enqueue(text,jsonb,text,text,jsonb),design_durable_synthesis.status(text,jsonb,text),design_durable_synthesis.lookup(text,jsonb,text),design_durable_synthesis.list(text,jsonb),design_durable_synthesis.cancel(text,jsonb,text) TO design_identity_runtime;
GRANT EXECUTE ON FUNCTION design_durable_synthesis.claim(),design_durable_synthesis.recheck(text,bigint),design_durable_synthesis.dispatch(text,bigint),design_durable_synthesis.finish(text,bigint,jsonb),design_durable_synthesis.fail(text,bigint) TO design_synthesis_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA design_durable_synthesis FROM PUBLIC,anon,authenticated,design_identity_runtime,design_synthesis_worker;
REVOKE CREATE ON SCHEMA design_durable_synthesis FROM design_identity_capability;
