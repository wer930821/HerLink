-- Web Push V1: enqueue match + message events for random chat.

-- 1) extend event types
ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_event_type_check;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_event_type_check
  CHECK (event_type IN ('new_match', 'new_message', 'verification_result', 'push_test', 'random_match', 'random_message'));

-- 2) enqueue_push_notification with session_id (keeps a 10-arg legacy overload)
DROP FUNCTION IF EXISTS public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB);

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
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_session_id UUID DEFAULT NULL
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

  IF p_event_type NOT IN ('new_match', 'new_message', 'verification_result', 'push_test', 'random_match', 'random_message') THEN
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
    session_id,
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
    p_session_id,
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.enqueue_push_notification(
    p_dedupe_key,
    p_event_type,
    p_user_id,
    p_actor_user_id,
    p_match_id,
    p_message_id,
    p_verification_id,
    p_title,
    p_body,
    p_payload,
    NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

-- 3) match push: fires once per session insert (dedupe keyed per user)
CREATE OR REPLACE FUNCTION public.handle_random_match_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM public.enqueue_push_notification(
      'random_match:' || NEW.id::text || ':' || NEW.user_a::text,
      'random_match',
      NEW.user_a,
      NEW.user_b,
      NULL,
      NULL,
      NULL,
      'HerLink 配對成功',
      '找到聊天對象了，點擊回到 HerLink。',
      jsonb_build_object(
        'type', 'match',
        'session_id', NEW.id,
        'target_url', '/session/' || NEW.id::text,
        'kind', 'random_match'
      ),
      NEW.id
    );

    PERFORM public.enqueue_push_notification(
      'random_match:' || NEW.id::text || ':' || NEW.user_b::text,
      'random_match',
      NEW.user_b,
      NEW.user_a,
      NULL,
      NULL,
      NULL,
      'HerLink 配對成功',
      '找到聊天對象了，點擊回到 HerLink。',
      jsonb_build_object(
        'type', 'match',
        'session_id', NEW.id,
        'target_url', '/session/' || NEW.id::text,
        'kind', 'random_match'
      ),
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_random_match_push_notification ON public.random_chat_sessions;
CREATE TRIGGER herlink_random_match_push_notification
AFTER INSERT ON public.random_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.handle_random_match_push_notification();

-- 4) message push: receiver only, no message body
CREATE OR REPLACE FUNCTION public.handle_random_message_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_row public.random_chat_sessions%ROWTYPE;
  recipient_user_id UUID;
BEGIN
  SELECT session_ref.*
  INTO session_row
  FROM public.random_chat_sessions AS session_ref
  WHERE session_ref.id = NEW.session_id;

  IF NOT FOUND OR session_row.status <> 'active' THEN
    RETURN NEW;
  END IF;

  recipient_user_id := CASE
    WHEN session_row.user_a = NEW.sender_id THEN session_row.user_b
    ELSE session_row.user_a
  END;

  IF recipient_user_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_push_notification(
    'random_message:' || NEW.id::text || ':' || recipient_user_id::text,
    'random_message',
    recipient_user_id,
    NEW.sender_id,
    NULL,
    NULL,
    NULL,
    'HerLink 有新訊息',
    CASE
      WHEN NEW.message_type = 'image' THEN '你收到一張圖片'
      ELSE '你收到一則新訊息'
    END,
    jsonb_build_object(
      'type', 'message',
      'session_id', NEW.session_id,
      'message_id', NEW.id,
      'target_url', '/session/' || NEW.session_id::text,
      'kind', 'random_message'
    ),
    NEW.session_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_random_message_push_notification ON public.random_chat_messages;
CREATE TRIGGER herlink_random_message_push_notification
AFTER INSERT ON public.random_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_random_message_push_notification();
