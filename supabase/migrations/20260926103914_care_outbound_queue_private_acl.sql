-- Stop exposing the legacy care-outbound worker queue to browser/client roles.
-- The App's automatic queue integration is disabled; the background worker
-- continues using service_role. This changes privileges/policies only, not rows.
REVOKE ALL PRIVILEGES ON TABLE public.care_outbound_queue FROM anon, authenticated;

DROP POLICY IF EXISTS "允许读取" ON public.care_outbound_queue;
DROP POLICY IF EXISTS "允许插入" ON public.care_outbound_queue;
DROP POLICY IF EXISTS "允许更新" ON public.care_outbound_queue;

-- Manual rollback if the worker/client architecture is intentionally reverted:
-- GRANT ALL PRIVILEGES ON TABLE public.care_outbound_queue TO anon, authenticated;
-- CREATE POLICY "允许读取" ON public.care_outbound_queue FOR SELECT TO anon USING (true);
-- CREATE POLICY "允许插入" ON public.care_outbound_queue FOR INSERT TO anon WITH CHECK (true);
-- CREATE POLICY "允许更新" ON public.care_outbound_queue FOR UPDATE TO anon USING (true) WITH CHECK (true);
