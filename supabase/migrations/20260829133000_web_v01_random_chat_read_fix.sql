CREATE OR REPLACE FUNCTION public.list_random_messages(
  p_session_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  sender_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  max_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_random_session_member(p_session_id, actor_id) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  RETURN QUERY
  SELECT
    message_row.id,
    message_row.session_id,
    message_row.sender_id,
    message_row.content,
    message_row.created_at
  FROM public.random_chat_messages AS message_row
  WHERE message_row.session_id = p_session_id
  ORDER BY message_row.created_at ASC, message_row.id ASC
  LIMIT max_limit;
END;
$$;
