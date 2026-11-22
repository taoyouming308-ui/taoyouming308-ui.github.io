-- ISOLATED PG17 synthetic fixture only. No production installation authorized.
-- Adds command identity to existing full archive writes without modifying old
-- full version/receipt bytes or definitions. No new identity or model grants.
BEGIN;
DO $$BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::int/10000<>17 OR to_regprocedure('design_dependency_authority.append_full(jsonb)') IS NULL OR to_regnamespace('design_browser_archive_command') IS NOT NULL THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_FIXTURE_REQUIRED';END IF;
END$$;
CREATE SCHEMA design_browser_archive_command AUTHORIZATION design_identity_owner;
REVOKE ALL ON SCHEMA design_browser_archive_command FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA design_browser_archive_command TO design_dependency_capability,design_identity_runtime;
GRANT CREATE ON SCHEMA design_browser_archive_command TO design_dependency_capability;
CREATE TABLE design_browser_archive_command.commands(request_key text PRIMARY KEY,authority jsonb NOT NULL,command jsonb NOT NULL);
ALTER TABLE design_browser_archive_command.commands OWNER TO design_identity_owner;
ALTER TABLE design_browser_archive_command.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_browser_archive_command.commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON design_browser_archive_command.commands FROM PUBLIC,anon,authenticated,design_identity_runtime;
GRANT SELECT,INSERT ON design_browser_archive_command.commands TO design_dependency_capability;
CREATE POLICY archive_command_read ON design_browser_archive_command.commands FOR SELECT TO design_dependency_capability USING(true);
CREATE POLICY archive_command_insert ON design_browser_archive_command.commands FOR INSERT TO design_dependency_capability WITH CHECK(true);
CREATE TRIGGER archive_command_immutable BEFORE UPDATE OR DELETE ON design_browser_archive_command.commands FOR EACH ROW EXECUTE FUNCTION design_private.reject_rewrite();

CREATE FUNCTION design_browser_archive_command.read_command(a jsonb,request_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;row design_browser_archive_command.commands;c jsonb;k text;v jsonb;rc jsonb;source jsonb;BEGIN
 IF session_user IS DISTINCT FROM 'design_identity_runtime' OR a IS DISTINCT FROM design_identity.require_authority() OR request_id IS NULL OR request_id!~'^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));b:=design_dependency_authority.read_bundle();
 IF b->'authority' IS DISTINCT FROM a THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_DENIED' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'actor',request_id));
 -- Immutable rows need no FOR SHARE/UPDATE privilege. The common transaction
 -- lock serializes all writers; there is no mutation or reclaim operation.
 SELECT * INTO row FROM design_browser_archive_command.commands WHERE request_key=k;
 IF NOT FOUND THEN
  IF a IS DISTINCT FROM design_identity.require_authority() THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_DENIED' USING ERRCODE='42501';END IF;RETURN null;
 END IF;
 c:=row.command;
 IF row.authority IS DISTINCT FROM a OR c->'authority' IS DISTINCT FROM a OR c->>'requestKey' IS DISTINCT FROM k OR c->>'requestId' IS DISTINCT FROM request_id THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_DENIED' USING ERRCODE='42501';END IF;
 SELECT x->'record' INTO STRICT v FROM jsonb_array_elements(b->'fullRows') x WHERE x->'version'=c->'resultVersion' AND x->'sha256'=c->'resultSha256';
 SELECT x->'receipt' INTO STRICT rc FROM jsonb_array_elements(b->'fullReceipts') x WHERE x->>'request_key'=k;
 SELECT x->'record' INTO STRICT source FROM jsonb_array_elements(b->'workflowRows') x WHERE x->'revision'=c->'sourceRevision' AND x->'sha256'=c->'sourceDigest';
 IF (v->>'requestId'=request_id AND v->'actor'=a->'actor' AND v->'scope'=a->'scope' AND v->'version'=c->'resultVersion' AND v->'sha256'=c->'resultSha256' AND rc->>'requestKey'=k AND rc->'version'=v->'version' AND rc->'sha256'=v->'sha256' AND rc->'scope'=a->'scope' AND v->'snapshot'->'evidence'=jsonb_build_object('session',source->'session','archives',source->'archives') AND EXISTS(SELECT 1 FROM jsonb_array_elements(b->'dependencyAuthors') x WHERE x->>'kind'='full' AND x->>'id'=v->>'version' AND x->'sha256'=v->'sha256' AND x->'authority'=a)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CORRUPT' USING ERRCODE='42501';END IF;
 IF b IS DISTINCT FROM design_dependency_authority.read_bundle() OR a IS DISTINCT FROM design_identity.require_authority() THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CHANGED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('command',c,'version',v,'receipt',rc);
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CORRUPT' USING ERRCODE='42501';END$$;

CREATE FUNCTION design_browser_archive_command.append_current(a jsonb,q jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;c jsonb;v jsonb;rc jsonb;head jsonb;source jsonb;k text;prior jsonb;expected jsonb;out jsonb;BEGIN
 IF session_user IS DISTINCT FROM 'design_identity_runtime' OR a IS DISTINCT FROM design_identity.require_authority() THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0));b:=design_dependency_authority.read_bundle();
 IF (jsonb_typeof(q)='object' AND (SELECT count(*) FROM jsonb_object_keys(q))=4 AND (q-ARRAY['command','expectedSourceFingerprint','version','receipt'])='{}' AND q->'expectedSourceFingerprint'=b->'sourceFingerprint' AND b->'authority'=a) IS DISTINCT FROM true THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CONFLICT' USING ERRCODE='42501';END IF;
 c:=q->'command';v:=q->'version';rc:=q->'receipt';
 IF (jsonb_typeof(c)='object' AND (SELECT count(*) FROM jsonb_object_keys(c))=10 AND (c-ARRAY['schemaVersion','authority','requestKey','requestId','sourceRevision','sourceDigest','expectedVersion','expectedParentDigest','resultVersion','resultSha256'])='{}' AND c->>'schemaVersion'='design-browser-archive-command-v1' AND c->'authority'=a AND jsonb_typeof(c->'requestId')='string' AND c->>'requestId'~'^[A-Za-z0-9_-]{1,80}$' AND jsonb_typeof(c->'requestKey')='string' AND c->>'requestKey'~'^[a-f0-9]{64}$' AND jsonb_typeof(c->'sourceRevision')='number' AND c->>'sourceRevision'~'^[0-9]{1,4}$' AND (c->>'sourceRevision')::int BETWEEN 0 AND 1000 AND jsonb_typeof(c->'sourceDigest')='string' AND c->>'sourceDigest'~'^[a-f0-9]{64}$' AND jsonb_typeof(c->'expectedVersion')='number' AND c->>'expectedVersion'~'^[0-9]{1,3}$' AND (c->>'expectedVersion')::int BETWEEN 0 AND 99 AND (c->'expectedParentDigest'='null'::jsonb OR jsonb_typeof(c->'expectedParentDigest')='string' AND c->>'expectedParentDigest'~'^[a-f0-9]{64}$') AND jsonb_typeof(c->'resultVersion')='number' AND c->'resultVersion'=to_jsonb((c->>'expectedVersion')::int+1) AND jsonb_typeof(c->'resultSha256')='string' AND c->>'resultSha256'~'^[a-f0-9]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_INVALID' USING ERRCODE='42501';END IF;
 k:=design_dependency_authority.digest(jsonb_build_array(a->'actor',c->'requestId'));
 IF c->>'requestKey' IS DISTINCT FROM k OR v->'requestId' IS DISTINCT FROM c->'requestId' OR v->'version' IS DISTINCT FROM c->'resultVersion' OR v->'sha256' IS DISTINCT FROM c->'resultSha256' THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_INVALID' USING ERRCODE='42501';END IF;
 prior:=design_browser_archive_command.read_command(a,c->>'requestId');
 IF prior IS NOT NULL THEN
  IF prior IS DISTINCT FROM jsonb_build_object('command',c,'version',v,'receipt',rc) THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CONFLICT' USING ERRCODE='42501';END IF;RETURN true;
 END IF;
 -- An old receipt is not evidence that this browser command was authorized.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'fullReceipts') x WHERE x->>'request_key'=k) THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CONFLICT' USING ERRCODE='42501';END IF;
 source:=b->'workflowRows'->-1;head:=b->'fullRows'->-1;
 IF (source IS NOT NULL AND c->'sourceRevision'=source->'revision' AND c->'sourceDigest'=source->'sha256' AND c->'expectedVersion'=coalesce(head->'version','0'::jsonb) AND c->'expectedParentDigest'=coalesce(head->'sha256','null'::jsonb)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CONFLICT' USING ERRCODE='42501';END IF;
 expected:=jsonb_build_object('expectedSourceFingerprint',b->'sourceFingerprint','expectedVersion',c->'expectedVersion','expectedParentDigest',c->'expectedParentDigest','version',v,'receipt',rc);
 IF design_dependency_authority.append_full(expected) IS DISTINCT FROM true THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CONFLICT' USING ERRCODE='42501';END IF;
 INSERT INTO design_browser_archive_command.commands VALUES(k,a,c);
 out:=design_browser_archive_command.read_command(a,c->>'requestId');
 IF out IS DISTINCT FROM jsonb_build_object('command',c,'version',v,'receipt',rc) THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_CORRUPT' USING ERRCODE='42501';END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RAISE EXCEPTION 'BROWSER_ARCHIVE_INVALID' USING ERRCODE='42501';END$$;
ALTER FUNCTION design_browser_archive_command.read_command(jsonb,text) OWNER TO design_dependency_capability;
ALTER FUNCTION design_browser_archive_command.append_current(jsonb,jsonb) OWNER TO design_dependency_capability;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_browser_archive_command FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION design_browser_archive_command.read_command(jsonb,text),design_browser_archive_command.append_current(jsonb,jsonb) TO design_identity_runtime;
REVOKE CREATE ON SCHEMA design_browser_archive_command FROM design_dependency_capability;
COMMIT;
