-- Customer and booking records are served through session-validated Edge APIs.
-- Revoke Data API access before enabling RLS so a permissive legacy policy cannot
-- keep the old public-key clients alive. Service-role callers remain unchanged.
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.bookings FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_profiles FROM PUBLIC, anon, authenticated;
