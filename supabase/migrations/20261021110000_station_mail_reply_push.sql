-- Station mail reply push: notify the user (native) when the admin replies.
-- Step 1: allow the new 'station_mail_reply' event type in
-- enqueue_push_notification (verbatim copy of the 20261009043000 definition
-- with only the whitelist extended). Delivery target resolves to 'native'
-- via the existing ELSE branch.
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

  IF p_event_type NOT IN ('verification_result', 'push_test', 'random_match', 'random_message', 'admin_mail', 'station_mail_reply') THEN
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
          AND web.revoked_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.push_tokens AS native
        WHERE native.user_id = p_user_id
          AND native.active = TRUE
          AND native.token_context = 'user'
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

-- Step 2: enqueue a push for the thread owner whenever an admin message is
-- inserted into a station mail thread. Failures never block the reply itself.
CREATE OR REPLACE FUNCTION public.notify_station_mail_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_subject text;
BEGIN
  SELECT t.user_id, t.subject INTO v_user_id, v_subject
  FROM public.station_mail_threads t
  WHERE t.id = NEW.thread_id;

  IF v_user_id IS NOT NULL THEN
    PERFORM public.enqueue_push_notification(
      'station_mail_reply:' || NEW.id::text,
      'station_mail_reply',
      v_user_id,
      NULL,
      NULL,
      NEW.id,
      NULL,
      '站長回覆了你的信',
      COALESCE(NULLIF(BTRIM(v_subject), ''), '站長信箱'),
      jsonb_build_object('thread_id', NEW.thread_id, 'target_url', '/mailbox'),
      NULL,
      NULL
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'station mail reply push enqueue failed for message % (SQLSTATE %, %)', NEW.id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_station_mail_reply_push ON public.station_mail_messages;
CREATE TRIGGER trg_station_mail_reply_push
  AFTER INSERT ON public.station_mail_messages
  FOR EACH ROW
  WHEN (NEW.sender_role = 'admin')
  EXECUTE FUNCTION public.notify_station_mail_reply();
