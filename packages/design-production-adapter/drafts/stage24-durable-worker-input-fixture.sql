-- OFFLINE SYNTHETIC PG17 ONLY. Job-bound inputs, not bearer impersonation or a key API.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic'
 OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only'
 OR current_setting('server_version_num')::int/10000<>17
 OR to_regprocedure('design_durable_synthesis.worker_job(text,bigint,text)') IS NULL
 OR to_regnamespace('design_durable_worker') IS NOT NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_DURABLE_WORKER_REQUIRED';END IF;
END$$;
CREATE SCHEMA design_durable_worker AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_durable_worker FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_durable_worker TO design_identity_capability,design_synthesis_worker;
GRANT CREATE ON SCHEMA design_durable_worker TO design_identity_capability;

CREATE FUNCTION design_durable_worker.prepare(id text,expected_fence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;b jsonb;r jsonb;v jsonb;
BEGIN
 -- The existing recheck action grants no ledger write permission. It is private,
 -- tied to actual session_user/backend/transaction/job/fence, never a caller GUC.
 j:=design_durable_synthesis.worker_job(id,expected_fence,'recheck');
 IF j.state<>'leased' THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.check_live(j);
 r:=design_policy_private.read_attempt(id);
 IF r->>'state' IS DISTINCT FROM 'pending' OR r->'authority' IS DISTINCT FROM j.authority OR r->'intent' IS DISTINCT FROM j.intent THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 b:=design_dependency_authority.read_bundle();
 v:=jsonb_build_object('lease',design_durable_synthesis.lease_dto(j),'record',b->'workflowRows'->-1->'record');
 PERFORM design_durable_synthesis.check_live(j);
 PERFORM design_durable_synthesis.clear_private();
 RETURN v;
END$$;

CREATE FUNCTION design_durable_worker.read_key(id text,expected_fence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j design_durable_synthesis.jobs%rowtype;r jsonb;c jsonb;v jsonb;
BEGIN
 j:=design_durable_synthesis.worker_job(id,expected_fence,'recheck');
 IF j.state<>'leased' OR j.intent->>'kind' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'DURABLE_LEASE_LOST' USING ERRCODE='42501';END IF;
 PERFORM design_durable_synthesis.check_live(j);
 r:=design_policy_private.read_attempt(id);
 IF r->>'state' IS DISTINCT FROM 'pending' OR r->'authority' IS DISTINCT FROM j.authority OR r->'intent' IS DISTINCT FROM j.intent THEN RAISE EXCEPTION 'DURABLE_CONFLICT' USING ERRCODE='42501';END IF;
 c:=design_candidate_provider_binding.context_for(j.authority,j.intent->>'requestId','completion_synthesis','external',j.intent->'evidenceBinding');
 IF c->'authority' IS DISTINCT FROM j.authority OR c->'keyBinding' IS DISTINCT FROM j.intent->'keyBinding' OR c->'sourceBinding' IS DISTINCT FROM j.intent->'sourceBinding' OR c->'evidenceBinding' IS DISTINCT FROM j.intent->'evidenceBinding' THEN RAISE EXCEPTION 'DURABLE_DENIED' USING ERRCODE='42501';END IF;
 v:=jsonb_build_object('lease',design_durable_synthesis.lease_dto(j),'keyRecord',c->'keyRecord');
 PERFORM design_durable_synthesis.check_live(j);
 PERFORM design_durable_synthesis.clear_private();
 RETURN v;
END$$;
ALTER FUNCTION design_durable_worker.prepare(text,bigint) OWNER TO design_identity_capability;
ALTER FUNCTION design_durable_worker.read_key(text,bigint) OWNER TO design_identity_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_durable_worker FROM PUBLIC,anon,authenticated,design_identity_runtime,design_synthesis_worker;
GRANT EXECUTE ON FUNCTION design_durable_worker.prepare(text,bigint),design_durable_worker.read_key(text,bigint) TO design_synthesis_worker;
REVOKE CREATE ON SCHEMA design_durable_worker FROM design_identity_capability;
