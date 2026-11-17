-- OFFLINE SYNTHETIC PG17 ONLY. Equivalent canonicalization with inline leaves.
-- No new API, cache, privileges, hash format or authorization shortcut.
-- Install only after stage17 fixture. Existing owner and ACL MUST be preserved.
-- Independent baseline tests must rename BOTH the old function and its recursive
-- references before installation; copying only its name would call this new body.
DO $install$
DECLARE original_owner oid;original_acl aclitem[];original_config text[];original_security boolean;original_volatility "char";original_language oid;original_return oid;
BEGIN
 IF current_database()<>'design_executor_synthetic' OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only' OR current_setting('server_version_num')::integer/10000<>17 OR to_regprocedure('design_dependency_authority.canonical(jsonb)') IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_FIXTURE_REQUIRED';END IF;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,prorettype INTO original_owner,original_acl,original_config,original_security,original_volatility,original_language,original_return FROM pg_proc WHERE oid='design_dependency_authority.canonical(jsonb)'::regprocedure;
 IF original_owner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='design_dependency_capability') OR original_security IS DISTINCT FROM false OR original_volatility IS DISTINCT FROM 'i' OR original_language IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql') OR original_return IS DISTINCT FROM 'text'::regtype::oid OR original_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_SIGNATURE_REQUIRED';END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION design_dependency_authority.canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE k text;x jsonb;r text;n numeric;child text;BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN
  r:='';FOR k,x IN SELECT key,value FROM jsonb_each(v) ORDER BY key COLLATE "C" LOOP
   IF k !~ '^[ -~]*$' THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;
    CASE jsonb_typeof(x)
    WHEN 'object','array' THEN child:=design_dependency_authority.canonical(x);
    WHEN 'number' THEN
     n:=(x::text)::numeric;
     IF abs(n)>9007199254740991 OR (n<>0 AND abs(n)<0.000001) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;
     child:=trim_scale(n)::text;
    WHEN 'string' THEN child:=to_jsonb(x#>>'{}')::text;
    WHEN 'boolean' THEN child:=x::text;
    WHEN 'null' THEN child:='null';
    ELSE RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END CASE;
   r:=r||CASE WHEN r='' THEN '' ELSE ',' END||to_jsonb(k)::text||':'||child;
  END LOOP;RETURN '{'||r||'}';
 WHEN 'array' THEN
  r:='';FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP
    CASE jsonb_typeof(x)
    WHEN 'object','array' THEN child:=design_dependency_authority.canonical(x);
    WHEN 'number' THEN
     n:=(x::text)::numeric;
     IF abs(n)>9007199254740991 OR (n<>0 AND abs(n)<0.000001) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;
     child:=trim_scale(n)::text;
    WHEN 'string' THEN child:=to_jsonb(x#>>'{}')::text;
    WHEN 'boolean' THEN child:=x::text;
    WHEN 'null' THEN child:='null';
    ELSE RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END CASE;
   r:=r||CASE WHEN r='' THEN '' ELSE ',' END||child;
  END LOOP;RETURN '['||r||']';
 WHEN 'number' THEN n:=(v::text)::numeric;IF abs(n)>9007199254740991 OR (n<>0 AND abs(n)<0.000001) THEN RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED';END IF;RETURN trim_scale(n)::text;
 WHEN 'string' THEN RETURN to_jsonb(v#>>'{}')::text;
 WHEN 'boolean' THEN RETURN v::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE RAISE EXCEPTION 'DEPENDENCY_AUTHORITY_INVALID';END CASE;
END$body$;
$definition$;
 -- Check catalog identity/ACL invariants in the same atomic installation block.
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='design_dependency_authority.canonical(jsonb)'::regprocedure AND (proowner IS DISTINCT FROM original_owner OR proacl IS DISTINCT FROM original_acl OR proconfig IS DISTINCT FROM original_config OR prosecdef IS DISTINCT FROM original_security OR provolatile IS DISTINCT FROM original_volatility OR prolang IS DISTINCT FROM original_language OR prorettype IS DISTINCT FROM original_return)) THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_PRIVILEGE_CHANGED';END IF;
END$install$;
