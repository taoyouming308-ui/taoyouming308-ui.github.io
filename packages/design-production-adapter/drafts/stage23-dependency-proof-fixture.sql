-- OFFLINE SYNTHETIC PG17 ONLY. Projection, not a smaller authorization check.
-- No caller-provided authority, head hash, digest, cache token or scope argument.
-- Production installation/EXECUTE grant requires a separate reviewed deployment.
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic'
 OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only'
 OR current_setting('server_version_num')::integer/10000<>17
 OR to_regprocedure('design_dependency_authority.read_bundle()') IS NULL
 OR to_regprocedure('design_dependency_authority.read_bundle_proof()') IS NOT NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_DEPENDENCY_PROOF_REQUIRED';END IF;
END$$;
CREATE FUNCTION design_dependency_authority.read_bundle_proof() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;a jsonb;now_ms bigint;
BEGIN
 -- Retains sources(), whole-source digest, manifest selection and expiry,
 -- source ownership, all existing media checks and advisory/row locks.
 b:=design_dependency_authority.read_bundle();
 a:=design_identity.require_authority();
 IF b->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CHANGED';END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF b->'manifest'<>'null'::jsonb AND (b->'manifest'->>'expiresAt')::numeric<=now_ms THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_EXPIRED';END IF;
 RETURN jsonb_build_object('schemaVersion','design-dependency-proof-v1','authority',a,
   'sourceFingerprint',b->'sourceFingerprint','manifest',b->'manifest','checkedAt',now_ms);
END$$;
ALTER FUNCTION design_dependency_authority.read_bundle_proof() OWNER TO design_dependency_capability;
REVOKE ALL ON FUNCTION design_dependency_authority.read_bundle_proof() FROM PUBLIC,anon,authenticated,design_workflow_manifest_issuer;
GRANT EXECUTE ON FUNCTION design_dependency_authority.read_bundle_proof() TO design_identity_runtime;
-- No table access, write capability, new credential or change to existing CAS.
