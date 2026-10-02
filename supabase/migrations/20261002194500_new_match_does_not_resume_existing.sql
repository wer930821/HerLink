-- "配對新的人" must never reopen an existing active chat.
-- Keep existing chats retained while creating/joining a separate new match.

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
  active_count INTEGER;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));

  SELECT count(*)
  INTO active_count
  FROM public.random_chat_sessions AS s
  WHERE s.status = 'active'
    AND (s.user_a = actor_id OR s.user_b = actor_id);

  IF active_count >= 3 THEN
    RETURN QUERY SELECT 'limit_reached'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.join_random_match_internal(actor_id, NULL);
END;
$$;

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
  candidate_user_id UUID;
  session_uuid UUID;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);

  SELECT profile.account_status, profile.anonymous_mode_enabled,
         profile.anonymous_display_name, profile.anonymous_avatar
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF actor_profile.account_status <> 'active' THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;
  IF NOT COALESCE(actor_profile.anonymous_mode_enabled, FALSE) THEN RAISE EXCEPTION 'Anonymous mode is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_display_name, '')) = '' THEN RAISE EXCEPTION 'Anonymous display name is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_avatar, '')) = '' THEN RAISE EXCEPTION 'Anonymous avatar is required.'; END IF;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status, joined_at = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at, matched_session_id = NULL;

  SELECT q.user_id
  INTO candidate_user_id
  FROM public.random_match_queue AS q
  JOIN public.profiles AS candidate ON candidate.id = q.user_id
  WHERE q.status = 'waiting'
    AND q.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR q.user_id <> p_excluded_user_id)
    AND candidate.account_status = 'active'
    AND COALESCE(candidate.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate.anonymous_display_name, '')) <> ''
    AND btrim(COALESCE(candidate.anonymous_avatar, '')) <> ''
    AND NOT public.has_block_between(p_actor_id, q.user_id)
    AND (SELECT count(*) FROM public.random_chat_sessions s
         WHERE s.status='active' AND (s.user_a=q.user_id OR s.user_b=q.user_id)) < 3
    AND NOT EXISTS (
      SELECT 1 FROM public.random_chat_sessions s
      WHERE s.status='active'
        AND ((s.user_a=p_actor_id AND s.user_b=q.user_id)
          OR (s.user_b=p_actor_id AND s.user_a=q.user_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.random_pair_history h
      WHERE h.pair_key=public.random_pair_key(p_actor_id,q.user_id)
        AND h.matched_at >= timezone('utc'::text,now()) - INTERVAL '24 hours'
    )
  ORDER BY q.joined_at ASC, q.user_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();
    INSERT INTO public.random_chat_sessions(id,user_a,user_b,status,created_at)
    VALUES(session_uuid,LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),'active',timezone('utc'::text,now()));

    INSERT INTO public.random_pair_history(pair_key,user_a,user_b,matched_at)
    VALUES(public.random_pair_key(p_actor_id,candidate_user_id),LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),timezone('utc'::text,now()));

    UPDATE public.random_match_queue
    SET status='matched',updated_at=timezone('utc'::text,now()),matched_session_id=session_uuid
    WHERE user_id IN(p_actor_id,candidate_user_id);

    RETURN QUERY SELECT 'matched'::TEXT,session_uuid,candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'waiting'::TEXT,NULL::UUID,NULL::UUID;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_join_random_match() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_random_match_internal(UUID, UUID) TO authenticated, service_role;
