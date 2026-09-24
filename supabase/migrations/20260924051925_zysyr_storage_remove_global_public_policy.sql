-- Remove the production-wide anonymous Storage policy.
-- Private finance buckets rely on API-side service_role operations and short-lived
-- signed URLs; the public showcase bucket remains public through bucket settings.
-- No Storage objects or finance records are modified.
DROP POLICY IF EXISTS anon_all ON storage.objects;
