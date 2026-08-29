CREATE TABLE IF NOT EXISTS public.random_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES auth.users ON DELETE SET NULL,
  ended_reason TEXT,
  CONSTRAINT random_chat_sessions_status_valid CHECK (status IN ('active', 'ended')),
  CONSTRAINT random_chat_sessions_canonical_pair CHECK (user_a < user_b),
  CONSTRAINT random_chat_sessions_unique_pair UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS random_chat_sessions_status_idx
  ON public.random_chat_sessions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS random_chat_sessions_user_a_idx
  ON public.random_chat_sessions (user_a);

CREATE INDEX IF NOT EXISTS random_chat_sessions_user_b_idx
  ON public.random_chat_sessions (user_b);

CREATE UNIQUE INDEX IF NOT EXISTS random_chat_sessions_user_a_active_idx
  ON public.random_chat_sessions (user_a)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS random_chat_sessions_user_b_active_idx
  ON public.random_chat_sessions (user_b)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.random_match_queue (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  matched_session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE SET NULL,
  CONSTRAINT random_match_queue_status_valid CHECK (status IN ('waiting', 'matched', 'left'))
);

CREATE INDEX IF NOT EXISTS random_match_queue_status_joined_idx
  ON public.random_match_queue (status, joined_at, user_id);

CREATE TABLE IF NOT EXISTS public.random_pair_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_key TEXT NOT NULL,
  user_a UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT random_pair_history_canonical_pair CHECK (user_a < user_b)
);

CREATE INDEX IF NOT EXISTS random_pair_history_pair_key_idx
  ON public.random_pair_history (pair_key, matched_at DESC);

ALTER TABLE public.random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.random_match_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.random_pair_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS random_chat_sessions_select_own ON public.random_chat_sessions;
CREATE POLICY random_chat_sessions_select_own
  ON public.random_chat_sessions
  FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS random_match_queue_select_own ON public.random_match_queue;
CREATE POLICY random_match_queue_select_own
  ON public.random_match_queue
  FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT ON public.random_chat_sessions TO authenticated, service_role;
GRANT SELECT ON public.random_match_queue TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.random_pair_key(p_user_a UUID, p_user_b UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(p_user_a, p_user_b)::TEXT || ':' || GREATEST(p_user_a, p_user_b)::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.find_or_join_random_match()
RETURNS TABLE (
  status TEXT,
  session_id UUID,
  matched_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_profile RECORD;
  actor_session RECORD;
  candidate_user_id UUID;
  session_uuid UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.reconcile_profile_enforcement_status(actor_id);

  SELECT
    profile.account_status,
    profile.onboarding_completed,
    profile.anonymous_mode_enabled,
    profile.anonymous_display_name,
    profile.anonymous_avatar
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF actor_profile.account_status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not eligible right now.';
  END IF;

  IF NOT COALESCE(actor_profile.onboarding_completed, FALSE) THEN
    RAISE EXCEPTION 'Complete onboarding first.';
  END IF;

  IF NOT COALESCE(actor_profile.anonymous_mode_enabled, FALSE) THEN
    RAISE EXCEPTION 'Anonymous mode is required.';
  END IF;

  IF btrim(COALESCE(actor_profile.anonymous_display_name, '')) = '' THEN
    RAISE EXCEPTION 'Anonymous display name is required.';
  END IF;

  IF btrim(COALESCE(actor_profile.anonymous_avatar, '')) = '' THEN
    RAISE EXCEPTION 'Anonymous avatar is required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));

  SELECT session_row.*
  INTO actor_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.status = 'active'
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      'matched'::TEXT,
      actor_session.id,
      CASE
        WHEN actor_session.user_a = actor_id THEN actor_session.user_b
        ELSE actor_session.user_a
      END;
    RETURN;
  END IF;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status,
      joined_at = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at,
      matched_session_id = NULL;

  SELECT queue_row.user_id
  INTO candidate_user_id
  FROM public.random_match_queue AS queue_row
  JOIN public.profiles AS candidate_profile
    ON candidate_profile.id = queue_row.user_id
  WHERE queue_row.status = 'waiting'
    AND queue_row.user_id <> actor_id
    AND candidate_profile.account_status = 'active'
    AND COALESCE(candidate_profile.onboarding_completed, FALSE) = TRUE
    AND COALESCE(candidate_profile.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate_profile.anonymous_display_name, '')) <> ''
    AND btrim(COALESCE(candidate_profile.anonymous_avatar, '')) <> ''
    AND NOT public.has_block_between(actor_id, queue_row.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS existing_session
      WHERE existing_session.status = 'active'
        AND (existing_session.user_a = queue_row.user_id OR existing_session.user_b = queue_row.user_id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_pair_history AS history
      WHERE history.pair_key = public.random_pair_key(actor_id, queue_row.user_id)
        AND history.matched_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
    )
  ORDER BY queue_row.joined_at ASC, queue_row.user_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();

    INSERT INTO public.random_chat_sessions (id, user_a, user_b, status, created_at)
    VALUES (
      session_uuid,
      LEAST(actor_id, candidate_user_id),
      GREATEST(actor_id, candidate_user_id),
      'active',
      timezone('utc'::text, now())
    );

    INSERT INTO public.random_pair_history (pair_key, user_a, user_b, matched_at)
    VALUES (
      public.random_pair_key(actor_id, candidate_user_id),
      LEAST(actor_id, candidate_user_id),
      GREATEST(actor_id, candidate_user_id),
      timezone('utc'::text, now())
    );

    UPDATE public.random_match_queue
    SET status = 'matched',
        updated_at = timezone('utc'::text, now()),
        matched_session_id = session_uuid
    WHERE user_id IN (actor_id, candidate_user_id);

    RETURN QUERY
    SELECT 'matched'::TEXT, session_uuid, candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'waiting'::TEXT, NULL::UUID, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_random_queue()
RETURNS TABLE (left_queue BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE user_id = actor_id
    AND status = 'waiting';

  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_random_session(p_session_id UUID DEFAULT NULL)
RETURNS TABLE (ended BOOLEAN, session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_session_id UUID;
  target_session_status TEXT;
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT session_row.id, session_row.status
    INTO target_session_id, target_session_status
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.id = p_session_id
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
    LIMIT 1;
  ELSE
    SELECT session_row.id, session_row.status
    INTO target_session_id, target_session_status
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.status = 'active'
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
    LIMIT 1;
  END IF;

  IF target_session_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID;
    RETURN;
  END IF;

  IF target_session_status = 'active' THEN
    UPDATE public.random_chat_sessions
    SET status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'left'
    WHERE id = target_session_id
      AND status = 'active'
      AND (user_a = actor_id OR user_b = actor_id);

    GET DIAGNOSTICS updated_rows = ROW_COUNT;

    IF updated_rows = 0 THEN
      RAISE EXCEPTION 'You are not allowed to end this session.';
    END IF;
  ELSIF target_session_status <> 'ended' THEN
    RAISE EXCEPTION 'You are not allowed to end this session.';
  END IF;

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE user_id = actor_id;

  RETURN QUERY SELECT TRUE, target_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.random_pair_key(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_or_join_random_match() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_random_queue() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_random_session(UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.random_chat_sessions;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.random_match_queue;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
