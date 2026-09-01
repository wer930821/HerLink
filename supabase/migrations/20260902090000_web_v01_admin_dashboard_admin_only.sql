-- Full dashboard data is only available to active role='admin' memberships.
DROP POLICY IF EXISTS "Active admins can read realtime diagnostics" ON public.realtime_diagnostics;
CREATE POLICY "Active admins can read realtime diagnostics" ON public.realtime_diagnostics FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all blocks" ON public.blocks;
CREATE POLICY "Active admins can read all blocks" ON public.blocks FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all random chat sessions" ON public.random_chat_sessions;
CREATE POLICY "Active admins can read all random chat sessions" ON public.random_chat_sessions FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all random match queue rows" ON public.random_match_queue;
CREATE POLICY "Active admins can read all random match queue rows" ON public.random_match_queue FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all random chat messages" ON public.random_chat_messages;
CREATE POLICY "Active admins can read all random chat messages" ON public.random_chat_messages FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all fraud risk events" ON public.fraud_risk_events;
CREATE POLICY "Active admins can read all fraud risk events" ON public.fraud_risk_events FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all moderation enforcements" ON public.moderation_enforcements;
CREATE POLICY "Active admins can read all moderation enforcements" ON public.moderation_enforcements FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read moderation cases" ON public.moderation_cases;
CREATE POLICY "Active admins can read moderation cases" ON public.moderation_cases FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read moderation logs" ON public.moderation_logs;
CREATE POLICY "Active admins can read moderation logs" ON public.moderation_logs FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all profiles" ON public.profiles;
CREATE POLICY "Active admins can read all profiles" ON public.profiles FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all reports" ON public.reports;
CREATE POLICY "Active admins can read all reports" ON public.reports FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all risk events" ON public.risk_events;
CREATE POLICY "Active admins can read all risk events" ON public.risk_events FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all verifications" ON public.verifications;
CREATE POLICY "Active admins can read all verifications" ON public.verifications FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read all profile photos" ON public.profile_photos;
CREATE POLICY "Active admins can read all profile photos" ON public.profile_photos FOR SELECT USING (public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Admins can read verification objects" ON storage.objects;
CREATE POLICY "Admins can read verification objects" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'verification-private' AND public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Admins can read all profile photo objects" ON storage.objects;
CREATE POLICY "Admins can read all profile photo objects" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'profile-photos' AND public.is_active_admin(ARRAY['admin']));
