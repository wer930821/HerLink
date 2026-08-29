CREATE TABLE IF NOT EXISTS public.push_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('new_match', 'new_message', 'verification_result')),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  match_id UUID REFERENCES public.matches ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages ON DELETE CASCADE,
  verification_id UUID REFERENCES public.verifications ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS push_notification_events_status_created_idx
ON public.push_notification_events (status, created_at ASC);

CREATE INDEX IF NOT EXISTS push_notification_events_user_created_idx
ON public.push_notification_events (user_id, created_at DESC);

ALTER TABLE public.push_notification_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_notification_events FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.push_notification_events TO service_role;

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

  IF p_event_type NOT IN ('new_match', 'new_message', 'verification_result') THEN
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

CREATE OR REPLACE FUNCTION public.handle_match_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM public.enqueue_push_notification(
      'new_match:' || NEW.id::text || ':' || NEW.user_1_id::text,
      'new_match',
      NEW.user_1_id,
      NEW.user_2_id,
      NEW.id,
      NULL,
      NULL,
      '妳有新的配對',
      '有人也想認識妳，現在可以開始聊天了。',
      jsonb_build_object('match_id', NEW.id, 'kind', 'new_match')
    );

    PERFORM public.enqueue_push_notification(
      'new_match:' || NEW.id::text || ':' || NEW.user_2_id::text,
      'new_match',
      NEW.user_2_id,
      NEW.user_1_id,
      NEW.id,
      NULL,
      NULL,
      '妳有新的配對',
      '有人也想認識妳，現在可以開始聊天了。',
      jsonb_build_object('match_id', NEW.id, 'kind', 'new_match')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_push_notification_on_match ON public.matches;
CREATE TRIGGER herlink_push_notification_on_match
AFTER INSERT ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.handle_match_push_notification();

CREATE OR REPLACE FUNCTION public.handle_message_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_user_id UUID;
  match_row public.matches%ROWTYPE;
BEGIN
  SELECT *
  INTO match_row
  FROM public.matches
  WHERE id = NEW.match_id;

  IF NOT FOUND OR match_row.status <> 'active' THEN
    RETURN NEW;
  END IF;

  recipient_user_id := CASE
    WHEN match_row.user_1_id = NEW.sender_id THEN match_row.user_2_id
    ELSE match_row.user_1_id
  END;

  IF recipient_user_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_push_notification(
    'new_message:' || NEW.id::text || ':' || recipient_user_id::text,
    'new_message',
    recipient_user_id,
    NEW.sender_id,
    NEW.match_id,
    NEW.id,
    NULL,
    '妳有一則新訊息',
    '打開 HerLink 看看最新對話。',
    jsonb_build_object(
      'match_id', NEW.match_id,
      'message_id', NEW.id,
      'kind', 'new_message'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_push_notification_on_message ON public.messages;
CREATE TRIGGER herlink_push_notification_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_message_push_notification();

CREATE OR REPLACE FUNCTION public.handle_verification_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  title_value TEXT;
  body_value TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('verified', 'rejected', 'manual_review') THEN
    RETURN NEW;
  END IF;

  title_value := CASE NEW.status
    WHEN 'verified' THEN '驗證審核完成'
    WHEN 'rejected' THEN '驗證需要重新提交'
    ELSE '驗證需要人工審核'
  END;

  body_value := CASE NEW.status
    WHEN 'verified' THEN '妳的真人驗證已通過。'
    WHEN 'rejected' THEN '妳的驗證未通過，請查看最新狀態後再重新送出。'
    ELSE '妳的驗證已轉入人工審核，完成後會再通知妳。'
  END;

  PERFORM public.enqueue_push_notification(
    'verification_result:' || NEW.id::text || ':' || NEW.status,
    'verification_result',
    NEW.user_id,
    NULL,
    NULL,
    NULL,
    NEW.id,
    title_value,
    body_value,
    jsonb_build_object(
      'verification_id', NEW.id,
      'status', NEW.status,
      'kind', 'verification_result'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_push_notification_on_verification ON public.verifications;
CREATE TRIGGER herlink_push_notification_on_verification
AFTER UPDATE ON public.verifications
FOR EACH ROW
EXECUTE FUNCTION public.handle_verification_push_notification();

GRANT EXECUTE ON FUNCTION public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;
