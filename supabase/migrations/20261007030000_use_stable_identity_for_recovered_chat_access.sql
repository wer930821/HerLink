-- Recovered anonymous users authenticate with a new auth.uid(), while their chat
-- participant identity remains the stable anonymous identity. Chat access must use
-- the stable identity and reserve auth.uid() only as an authentication gate.

CREATE OR REPLACE FUNCTION public.get_random_chat_message_count(p_session_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH actor AS (
    SELECT public.resolve_active_anonymous_chat_identity() AS id
  )
  SELECT count(*)
  FROM public.random_chat_messages m
  JOIN public.random_chat_sessions s ON s.id = m.session_id
  CROSS JOIN actor a
  WHERE m.session_id = p_session_id
    AND a.id IS NOT NULL
    AND (s.user_a = a.id OR s.user_b = a.id);
$function$;

CREATE OR REPLACE FUNCTION public.mark_random_session_read(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.random_chat_sessions s
    WHERE s.id = p_session_id
      AND (s.user_a = actor_id OR s.user_b = actor_id)
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.random_chat_session_reads (session_id, user_id, last_read_at)
  VALUES (p_session_id, actor_id, now())
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  RETURN true;
END;
$function$;

-- Preserve the current send_random_message implementation and only replace its
-- participant principal. This avoids duplicating its moderation/media/reply logic.
DO $migration$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'send_random_message'
    AND pg_get_function_identity_arguments(p.oid) = 'p_session_id uuid, p_content text, p_reply_to_message_id uuid';

  IF fn IS NULL THEN
    RAISE EXCEPTION 'send_random_message(uuid,text,uuid) not found';
  END IF;

  IF position('actor_id UUID := public.resolve_active_anonymous_chat_identity();' in fn) > 0
     OR position('actor_id uuid := public.resolve_active_anonymous_chat_identity();' in fn) > 0 THEN
    RETURN;
  END IF;

  IF position('actor_id UUID := auth.uid();' in fn) > 0 THEN
    fn := replace(
      fn,
      'actor_id UUID := auth.uid();',
      'actor_id UUID := public.resolve_active_anonymous_chat_identity();'
    );
  ELSIF position('actor_id uuid := auth.uid();' in fn) > 0 THEN
    fn := replace(
      fn,
      'actor_id uuid := auth.uid();',
      'actor_id uuid := public.resolve_active_anonymous_chat_identity();'
    );
  ELSE
    RAISE EXCEPTION 'Unexpected send_random_message actor identity declaration';
  END IF;

  EXECUTE fn;
END;
$migration$;
