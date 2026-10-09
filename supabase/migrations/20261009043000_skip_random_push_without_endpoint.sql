-- Avoid creating random-chat push work when the recipient cannot receive push.
-- This keeps push_test / verification / admin flows unchanged.
CREATE OR REPLACE FUNCTION public.enqueue_push_notification(
  p_dedupe_key text,
  p_event_type text,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_match_id uuid,
  p_message_id uuid,
  p_verification_id uuid,
  p_title text,
  p_body text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_session_id uuid DEFAULT NULL::uuid,
  p_delivery_target text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  event_id uuid;
  resolved_target text;
  expected_target text;
  has_push_endpoint boolean;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_dedupe_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification dedupe key is required.';
  END IF;

  IF p_event_type NOT IN ('verification_result', 'push_test', 'random_match', 'random_message', 'admin_mail') THEN
    RAISE EXCEPTION 'Unsupported push notification event type.';
  END IF;

  expected_target := CASE
    WHEN p_event_type IN ('random_match', 'random_message') THEN 'both'
    ELSE 'native'
  END;

  resolved_target := LOWER(BTRIM(COALESCE(p_delivery_target, expected_target)));
  IF resolved_target NOT IN ('web', 'native', 'both') THEN
    RAISE EXCEPTION 'Unsupported push delivery target.';
  END IF;
  IF resolved_target <> expected_target THEN
    RAISE EXCEPTION 'Push delivery target does not match event type.';
  END IF;

  IF p_event_type IN ('random_match', 'random_message') THEN
    SELECT
      EXISTS (
        SELECT 1
        FROM public.web_push_subscriptions AS web
        WHERE web.user_id = p_user_id
          AND web.is_active = TRUE
      )
      OR EXISTS (
        SELECT 1
        FROM public.push_tokens AS native
        WHERE native.user_id = p_user_id
          AND native.is_active = TRUE
      )
    INTO has_push_endpoint;

    IF NOT COALESCE(has_push_endpoint, FALSE) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.push_notification_events (
    dedupe_key, event_type, user_id, actor_user_id, verification_id,
    session_id, delivery_target, title, body, payload
  )
  VALUES (
    p_dedupe_key, p_event_type, p_user_id, p_actor_user_id, p_verification_id,
    p_session_id, resolved_target, p_title, p_body, COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT id INTO event_id
    FROM public.push_notification_events
    WHERE dedupe_key = p_dedupe_key;
  END IF;

  RETURN event_id;
END;
$function$;
