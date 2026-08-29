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

    IF target_session_id IS NULL THEN
      RAISE EXCEPTION 'This session is not available.';
    END IF;
  ELSE
    SELECT session_row.id, session_row.status
    INTO target_session_id, target_session_status
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.status = 'active'
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
    LIMIT 1;

    IF target_session_id IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID;
      RETURN;
    END IF;
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
