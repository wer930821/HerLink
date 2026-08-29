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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT session_row.id, session_row.status
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

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
  SELECT * FROM public.find_or_join_random_match();
END;
$$;
