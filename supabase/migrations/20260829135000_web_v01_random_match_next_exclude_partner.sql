CREATE OR REPLACE FUNCTION public.join_random_match_internal(
  p_actor_id UUID,
  p_excluded_user_id UUID DEFAULT NULL
)
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
  actor_profile RECORD;
  actor_session RECORD;
  candidate_user_id UUID;
  session_uuid UUID;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);

  SELECT
    profile.account_status,
    profile.onboarding_completed,
    profile.anonymous_mode_enabled,
    profile.anonymous_display_name,
    profile.anonymous_avatar
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

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

  SELECT session_row.*
  INTO actor_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.status = 'active'
    AND (session_row.user_a = p_actor_id OR session_row.user_b = p_actor_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      'matched'::TEXT,
      actor_session.id,
      CASE
        WHEN actor_session.user_a = p_actor_id THEN actor_session.user_b
        ELSE actor_session.user_a
      END;
    RETURN;
  END IF;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
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
    AND queue_row.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR queue_row.user_id <> p_excluded_user_id)
    AND candidate_profile.account_status = 'active'
    AND COALESCE(candidate_profile.onboarding_completed, FALSE) = TRUE
    AND COALESCE(candidate_profile.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate_profile.anonymous_display_name, '')) <> ''
    AND btrim(COALESCE(candidate_profile.anonymous_avatar, '')) <> ''
    AND NOT public.has_block_between(p_actor_id, queue_row.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS existing_session
      WHERE existing_session.status = 'active'
        AND (existing_session.user_a = queue_row.user_id OR existing_session.user_b = queue_row.user_id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_pair_history AS history
      WHERE history.pair_key = public.random_pair_key(p_actor_id, queue_row.user_id)
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
      LEAST(p_actor_id, candidate_user_id),
      GREATEST(p_actor_id, candidate_user_id),
      'active',
      timezone('utc'::text, now())
    );

    INSERT INTO public.random_pair_history (pair_key, user_a, user_b, matched_at)
    VALUES (
      public.random_pair_key(p_actor_id, candidate_user_id),
      LEAST(p_actor_id, candidate_user_id),
      GREATEST(p_actor_id, candidate_user_id),
      timezone('utc'::text, now())
    );

    UPDATE public.random_match_queue
    SET status = 'matched',
        updated_at = timezone('utc'::text, now()),
        matched_session_id = session_uuid
    WHERE user_id IN (p_actor_id, candidate_user_id);

    RETURN QUERY
    SELECT 'matched'::TEXT, session_uuid, candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'waiting'::TEXT, NULL::UUID, NULL::UUID;
END;
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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));
  RETURN QUERY SELECT * FROM public.join_random_match_internal(actor_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.next_random_match(
  p_session_id UUID
)
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
  target_session RECORD;
  other_participant UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT session_row.id, session_row.status, session_row.user_a, session_row.user_b
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  other_participant := CASE
    WHEN target_session.user_a = actor_id THEN target_session.user_b
    ELSE target_session.user_a
  END;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));

  IF target_session.status = 'active' THEN
    UPDATE public.random_chat_sessions AS session_row
    SET status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'next'
    WHERE session_row.id = p_session_id
      AND session_row.status = 'active'
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This session is not available.';
    END IF;
  END IF;

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE user_id = actor_id;

  RETURN QUERY
  SELECT * FROM public.join_random_match_internal(actor_id, other_participant);
END;
$$;
