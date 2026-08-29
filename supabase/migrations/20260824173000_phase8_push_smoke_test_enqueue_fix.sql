CREATE OR REPLACE FUNCTION public.enqueue_push_notification(
  p_dedupe_key TEXT,
  p_event_type TEXT,
  p_user_id UUID,
  p_actor_user_id UUID,
  p_match_id UUID,
  p_message_id UUID,
  p_verification_id UUID,
  p_title TEXT,
  p_body TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id UUID;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_dedupe_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification dedupe key is required.';
  END IF;

  IF p_event_type NOT IN ('new_match', 'new_message', 'verification_result', 'push_test') THEN
    RAISE EXCEPTION 'Unsupported push notification event type.';
  END IF;

  INSERT INTO public.push_notification_events (
    dedupe_key,
    event_type,
    user_id,
    actor_user_id,
    match_id,
    message_id,
    verification_id,
    title,
    body,
    payload
  )
  VALUES (
    p_dedupe_key,
    p_event_type,
    p_user_id,
    p_actor_user_id,
    p_match_id,
    p_message_id,
    p_verification_id,
    p_title,
    p_body,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT id
    INTO event_id
    FROM public.push_notification_events
    WHERE dedupe_key = p_dedupe_key;
  END IF;

  RETURN event_id;
END;
$$;
