CREATE OR REPLACE FUNCTION public.decline_ai_helper_handoff(p_session_id UUID)
RETURNS TABLE (released BOOLEAN, resumed_waiting BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target RECORD;
  partner_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));

  SELECT s.* INTO target
  FROM public.random_chat_sessions s
  WHERE s.id = p_session_id
    AND s.status = 'active'
    AND (s.user_a = actor_id OR s.user_b = actor_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE;
    RETURN;
  END IF;

  partner_id := CASE WHEN target.user_a = actor_id THEN target.user_b ELSE target.user_a END;

  UPDATE public.random_chat_sessions
  SET status = 'ended',
      ended_at = timezone('utc'::text, now()),
      ended_by = actor_id,
      ended_reason = 'ai_helper_handoff_declined'
  WHERE id = p_session_id AND status = 'active';

  -- The normal matcher records pair history as soon as it creates a session.
  -- A helper handoff decline/timeout means the human introduction was never
  -- accepted, so remove only the history row created for this exact session.
  -- This prevents an unaccepted handoff from triggering the 24-hour rematch block.
  DELETE FROM public.random_pair_history h
  WHERE h.pair_key = public.random_pair_key(target.user_a, target.user_b)
    AND h.user_a = target.user_a
    AND h.user_b = target.user_b
    AND h.matched_at >= target.created_at - INTERVAL '1 second'
    AND h.matched_at <= target.created_at + INTERVAL '1 second';

  INSERT INTO public.random_match_queue(user_id,status,joined_at,updated_at,matched_session_id)
  VALUES(actor_id,'waiting',timezone('utc'::text,now()),timezone('utc'::text,now()),NULL)
  ON CONFLICT(user_id) DO UPDATE SET status='waiting',joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at,matched_session_id=NULL;

  INSERT INTO public.random_match_queue(user_id,status,joined_at,updated_at,matched_session_id)
  VALUES(partner_id,'waiting',timezone('utc'::text,now()),timezone('utc'::text,now()),NULL)
  ON CONFLICT(user_id) DO UPDATE SET status='waiting',joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at,matched_session_id=NULL;

  RETURN QUERY SELECT TRUE, TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_ai_helper_handoff(UUID) TO authenticated, service_role;

-- Admin chat-session statistics must represent accepted/real human chat sessions.
-- Sessions created only to offer a human handoff from the AI helper are excluded
-- when that handoff is declined or times out.
CREATE OR REPLACE FUNCTION public.get_admin_random_chat_stats()
RETURNS TABLE (
  today_users BIGINT,
  today_messages BIGINT,
  today_sessions BIGINT,
  today_queue_joins BIGINT,
  seven_day_users BIGINT,
  seven_day_messages BIGINT,
  seven_day_sessions BIGINT,
  seven_day_queue_joins BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  today_start TIMESTAMPTZ :=
    ((timezone('Asia/Taipei', now()))::date::timestamp AT TIME ZONE 'Asia/Taipei');
  seven_day_start TIMESTAMPTZ := now() - INTERVAL '7 days';
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = actor_id
      AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(DISTINCT sender_id)
       FROM public.random_chat_messages
      WHERE created_at >= today_start),
    (SELECT COUNT(*)
       FROM public.random_chat_messages
      WHERE created_at >= today_start),
    (SELECT COUNT(*)
       FROM public.random_chat_sessions
      WHERE created_at >= today_start
        AND ended_reason IS DISTINCT FROM 'ai_helper_handoff_declined'),
    (SELECT COUNT(*)
       FROM public.random_match_queue
      WHERE joined_at >= today_start),
    (SELECT COUNT(DISTINCT sender_id)
       FROM public.random_chat_messages
      WHERE created_at >= seven_day_start),
    (SELECT COUNT(*)
       FROM public.random_chat_messages
      WHERE created_at >= seven_day_start),
    (SELECT COUNT(*)
       FROM public.random_chat_sessions
      WHERE created_at >= seven_day_start
        AND ended_reason IS DISTINCT FROM 'ai_helper_handoff_declined'),
    (SELECT COUNT(*)
       FROM public.random_match_queue
      WHERE joined_at >= seven_day_start);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_random_chat_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_random_chat_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_random_chat_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_random_chat_stats() TO service_role;
