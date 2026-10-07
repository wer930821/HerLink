-- Permanent recovery keeps chat ownership on the stable anonymous identity.
-- Any chat RPC that checks membership or authorship must resolve that identity
-- instead of comparing random_chat_sessions participants to the transient auth UID.

CREATE OR REPLACE FUNCTION public.get_random_chat_message_count(p_session_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
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
  auth_user_id uuid := auth.uid();
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
BEGIN
  IF auth_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Anonymous identity is not available.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.random_chat_sessions s
    WHERE s.id = p_session_id AND (s.user_a = actor_id OR s.user_b = actor_id)
  ) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  INSERT INTO public.random_chat_session_reads(session_id,user_id,last_read_at,updated_at)
  VALUES(p_session_id,actor_id,timezone('utc',now()),timezone('utc',now()))
  ON CONFLICT(session_id,user_id) DO UPDATE
  SET last_read_at=excluded.last_read_at,updated_at=excluded.updated_at;
  RETURN true;
END;
$function$;

-- Patch the current send_random_message implementation in production so its
-- participant/sender identity follows the recovered stable identity. The full
-- function body is maintained by the database migration applied alongside this
-- repository migration; this guard documents and verifies the invariant for
-- future migrations.
DO $block$
BEGIN
  IF position(
    'resolve_active_anonymous_chat_identity' IN
    pg_get_functiondef('public.send_random_message(uuid,text,text,text,text,bigint,integer,integer,uuid)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'send_random_message must use resolve_active_anonymous_chat_identity()';
  END IF;
END;
$block$;

COMMENT ON FUNCTION public.get_random_chat_message_count(uuid) IS
  'Counts messages for the current stable anonymous chat identity, including after permanent recovery.';
COMMENT ON FUNCTION public.mark_random_session_read(uuid) IS
  'Marks a session read for the current stable anonymous chat identity, including after permanent recovery.';
