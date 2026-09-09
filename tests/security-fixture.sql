CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users, display_name TEXT, birthday DATE, city TEXT, bio TEXT,
  orientation TEXT, identity_label TEXT, relationship_goals TEXT[], interests TEXT[], verified BOOLEAN DEFAULT false,
  account_status TEXT DEFAULT 'active', anonymous_mode_enabled BOOLEAN DEFAULT true, anonymous_display_name TEXT,
  anonymous_intro TEXT, anonymous_avatar TEXT, anonymous_age_visibility TEXT DEFAULT 'range',
  custom_relationship_goal TEXT
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON public.profiles USING (id = auth.uid());
CREATE TABLE public.blocks (blocker_id UUID, blocked_user_id UUID);
CREATE FUNCTION public.has_block_between(a UUID, b UUID) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id=a AND blocked_user_id=b) OR (blocker_id=b AND blocked_user_id=a))
$$;
CREATE FUNCTION public.reconcile_profile_enforcement_status(UUID) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.reconcile_anonymous_matchmaking_identity(UUID) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_anonymous_matchmaking_allowed(UUID) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.record_anonymous_risk_event_by_user_id(UUID, TEXT, JSONB) RETURNS VOID LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.random_chat_sessions (
  id UUID PRIMARY KEY, user_a UUID REFERENCES auth.users, user_b UUID REFERENCES auth.users,
  status TEXT, created_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ, ended_by UUID, ended_reason TEXT
);
CREATE TABLE public.random_chat_messages (
  id UUID PRIMARY KEY, session_id UUID REFERENCES random_chat_sessions ON DELETE CASCADE, sender_id UUID,
  content TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.random_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY random_chat_sessions_select_own ON public.random_chat_sessions USING (auth.uid() IN (user_a,user_b));
CREATE POLICY random_chat_messages_select_participant ON public.random_chat_messages USING (true);
GRANT SELECT ON public.random_chat_sessions, public.random_chat_messages TO authenticated;
CREATE TABLE public.random_match_queue (user_id UUID PRIMARY KEY, status TEXT, joined_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, matched_session_id UUID);
CREATE TABLE public.random_pair_history (pair_key TEXT, user_a UUID, user_b UUID, matched_at TIMESTAMPTZ);
CREATE TABLE public.cleanup_job_runs (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_name TEXT, affected_rows INTEGER DEFAULT 0, status TEXT, error TEXT, started_at TIMESTAMPTZ DEFAULT now(), finished_at TIMESTAMPTZ);
CREATE FUNCTION public.random_pair_key(a UUID,b UUID) RETURNS TEXT LANGUAGE sql AS $$ SELECT least(a,b)::text || ':' || greatest(a,b)::text $$;
CREATE FUNCTION public.join_random_match_internal(UUID, UUID DEFAULT NULL) RETURNS TABLE (status TEXT, session_id UUID, matched_user_id UUID) LANGUAGE sql AS $$ SELECT 'waiting', NULL::uuid, NULL::uuid $$;
CREATE TABLE storage.objects (id UUID, bucket_id TEXT, name TEXT);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(TEXT) RETURNS TEXT[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
CREATE FUNCTION public.chat_media_path_session_id(TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT split_part($1,'/',1)::uuid $$;
CREATE FUNCTION public.cleanup_stale_random_queue(INTERVAL) RETURNS INT LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.cleanup_chat_media_orphans(INTERVAL) RETURNS INT LANGUAGE sql AS $$ SELECT 0 $$;
CREATE PUBLICATION supabase_realtime;
