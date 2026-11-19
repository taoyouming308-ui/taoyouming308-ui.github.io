-- ISOLATED LOCAL TEST ONLY. Not a production migration or permission grant.
-- Add HEIC/HEIF to the original media capability's data grammar. Old hashes,
-- identity checks, scope, byte/pixel limits, owner and ACL are unchanged.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'design_executor_synthetic'
 OR current_setting('design_executor.synthetic_fixture',true) IS DISTINCT FROM 'offline-stage6-only'
 OR current_setting('server_version_num')::int/10000<>17
 OR to_regprocedure('design_dependency_authority.insert_media(jsonb)') IS NULL THEN
  RAISE EXCEPTION 'STAGE42_SYNTHETIC_ONLY';
 END IF;
END $guard$;
DO $patch$
DECLARE src text;old text:=$old$coalesce(r->>'mime','') NOT IN ('image/jpeg','image/png','image/webp')$old$;
 next text:=$new$coalesce(r->>'mime','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')$new$;
BEGIN
 SELECT pg_get_functiondef('design_dependency_authority.insert_media(jsonb)'::regprocedure) INTO src;
 IF (length(src)-length(replace(src,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'STAGE42_PATCH_MISMATCH';END IF;
 EXECUTE replace(src,old,next);
END $patch$;
COMMIT;
