CREATE TABLE IF NOT EXISTS public.random_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT random_chat_messages_not_blank CHECK (length(btrim(content)) > 0),
  CONSTRAINT random_chat_messages_length_check CHECK (length(content) <= 2000)
);

CREATE INDEX IF NOT EXISTS random_chat_messages_session_created_idx
  ON public.random_chat_messages (session_id, created_at, id);

CREATE INDEX IF NOT EXISTS random_chat_messages_sender_id_idx
  ON public.random_chat_messages (sender_id);

ALTER TABLE public.random_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS random_chat_messages_select_participant ON public.random_chat_messages;
CREATE POLICY random_chat_messages_select_participant
  ON public.random_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS session_row
      WHERE session_row.id = random_chat_messages.session_id
        AND (session_row.user_a = auth.uid() OR session_row.user_b = auth.uid())
    )
  );

GRANT SELECT ON public.random_chat_messages TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_random_session_member(
  p_session_id UUID,
  p_user_id UUID,
  p_required_status TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.id = p_session_id
      AND (session_row.user_a = p_user_id OR session_row.user_b = p_user_id)
      AND (p_required_status IS NULL OR session_row.status = p_required_status)
  );
$$;

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

  PERFORM public.reconcile_profile_enforcement_status(actor_id);

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not available.';
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

CREATE OR REPLACE FUNCTION public.send_random_message(
  p_session_id UUID,
  p_content TEXT
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  sender_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  cleaned_content TEXT := btrim(COALESCE(p_content, ''));
  target_session RECORD;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF cleaned_content = '' THEN
    RAISE EXCEPTION 'Message cannot be blank.';
  END IF;

  IF length(cleaned_content) > 2000 THEN
    RAISE EXCEPTION 'Message is too long.';
  END IF;

  PERFORM public.reconcile_profile_enforcement_status(actor_id);

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not available.';
  END IF;

  SELECT session_row.id, session_row.status
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND session_row.status = 'active'
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  RETURN QUERY
  INSERT INTO public.random_chat_messages (session_id, sender_id, content)
  VALUES (p_session_id, actor_id, cleaned_content)
  RETURNING
    random_chat_messages.id,
    random_chat_messages.session_id,
    random_chat_messages.sender_id,
    random_chat_messages.content,
    random_chat_messages.created_at;
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
    UPDATE public.random_chat_sessions
    SET status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'next'
    WHERE id = p_session_id
      AND status = 'active'
      AND (user_a = actor_id OR user_b = actor_id);

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

GRANT EXECUTE ON FUNCTION public.is_random_session_member(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_random_messages(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_random_message(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_random_match(UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.random_chat_messages;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
