-- random_chat_messages is not the legacy public.messages table.  Do not write
-- its id to push_notification_events.message_id, whose FK targets public.messages.
-- Push enqueueing is best-effort: a notification failure must never roll back chat.

CREATE OR REPLACE FUNCTION public.handle_random_message_push_notification()
RETURNS TRIGGER
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

  BEGIN
    PERFORM public.enqueue_push_notification(
      'random_message:' || NEW.id::text || ':' || recipient_user_id::text,
      'random_message',
      recipient_user_id,
      NEW.sender_id,
      NULL,
      NULL, -- random_chat_messages.id has no FK relationship to public.messages
      NULL,
      'HerLink 有新訊息',
      CASE WHEN NEW.message_type = 'image' THEN '你收到一張圖片' ELSE '你收到一則新訊息' END,
      jsonb_build_object(
        'type', 'message',
        'session_id', NEW.session_id,
        'message_id', NEW.id,
        'target_url', '/session/' || NEW.session_id::text,
        'kind', 'random_message'
      ),
      NEW.session_id
    );
  EXCEPTION WHEN OTHERS THEN
    -- Retain the actual database error in Postgres logs without aborting NEW.
    RAISE WARNING 'Random-chat push enqueue failed for session %, message % (SQLSTATE %, %)',
      NEW.session_id, NEW.id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
