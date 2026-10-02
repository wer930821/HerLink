-- Show the anonymous sender and message preview directly in random-chat notifications.
CREATE OR REPLACE FUNCTION public.handle_random_message_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  session_row public.random_chat_sessions%ROWTYPE;
  recipient_user_id UUID;
  sender_name TEXT;
  notification_body TEXT;
BEGIN
  SELECT session_ref.* INTO session_row
  FROM public.random_chat_sessions AS session_ref
  WHERE session_ref.id = NEW.session_id;

  IF NOT FOUND OR session_row.status <> 'active' THEN RETURN NEW; END IF;

  recipient_user_id := CASE WHEN session_row.user_a = NEW.sender_id THEN session_row.user_b ELSE session_row.user_a END;
  IF recipient_user_id = NEW.sender_id THEN RETURN NEW; END IF;

  SELECT NULLIF(btrim(profile.anonymous_display_name), '')
  INTO sender_name
  FROM public.profiles AS profile
  WHERE profile.id = NEW.sender_id;

  sender_name := COALESCE(sender_name, '匿名使用者');
  notification_body := CASE
    WHEN NEW.message_type = 'image' THEN '傳送了一張圖片'
    ELSE left(regexp_replace(COALESCE(NEW.content, ''), E'[\\n\\r\\t]+', ' ', 'g'), 120)
  END;
  IF btrim(notification_body) = '' THEN notification_body := '傳送了一則訊息'; END IF;

  BEGIN
    PERFORM public.enqueue_push_notification(
      'random_message:' || NEW.id::text || ':' || recipient_user_id::text,
      'random_message', recipient_user_id, NEW.sender_id, NULL, NULL, NULL,
      sender_name, notification_body,
      jsonb_build_object(
        'type','message','session_id',NEW.session_id,'message_id',NEW.id,
        'target_url','/session/' || NEW.session_id::text,'kind','random_message',
        'sender_name',sender_name
      ),
      NEW.session_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Random-chat push enqueue failed for session %, message % (SQLSTATE %, %)',
      NEW.session_id, NEW.id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
