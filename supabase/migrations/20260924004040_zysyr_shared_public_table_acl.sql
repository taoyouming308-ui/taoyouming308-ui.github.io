-- Tighten anonymous access to legacy hair configuration and public perm recipes.
-- This migration deliberately does not change bookings/customer_profiles policies;
-- those tables remain open only until their callers are moved behind scoped APIs.

ALTER TABLE public.hair_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perm_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perm_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_identities ENABLE ROW LEVEL SECURITY;

-- hair_types and perm_styles are no longer used by the active app. The only
-- remaining editor is admin-panel.html, which redirects to admin.html before
-- loading its legacy editor. Keep access for service_role/Postgres only.
REVOKE ALL PRIVILEGES ON TABLE public.hair_types FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.perm_styles FROM PUBLIC, anon, authenticated;

-- Device-to-barber hints were only written by browser clients and have no
-- active readers. Keep the historical rows, but close direct API access.
REVOKE ALL PRIVILEGES ON TABLE public.barber_identities FROM PUBLIC, anon, authenticated;

-- perm_data is intentionally displayed in the public app. Preserve reads while
-- removing direct public writes; future edits must go through a privileged API.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.perm_data FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.perm_data TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read perm_data" ON public.perm_data;
CREATE POLICY "Public can read perm_data"
  ON public.perm_data
  FOR SELECT
  TO anon, authenticated
  USING (true);
