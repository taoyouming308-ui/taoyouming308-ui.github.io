-- Service-only namespace lookup needed by the new SECURITY INVOKER wrappers.
-- This grants neither CREATE, function EXECUTE, table access nor store grants.
-- Existing private helper EXECUTE ACLs, authenticated/anon ACLs and RLS remain
-- unchanged. Rollback, if this was previously absent: REVOKE USAGE ON SCHEMA
-- zysyr_private FROM service_role (also disables the new review endpoints).
grant usage on schema zysyr_private to service_role;
