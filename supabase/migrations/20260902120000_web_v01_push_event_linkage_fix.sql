-- Preserve source linkage for production diagnostics.  Delivery uses session_id,
-- so this fixes observability without exposing message content in notifications.
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
  SELECT session_ref.* INTO session_row FROM public.random_chat_sessions AS session_ref WHERE session_ref.id = NEW.session_id;
  IF NOT FOUND OR session_row.status <> 'active' THEN RETURN NEW; END IF;
  recipient_user_id := CASE WHEN session_row.user_a = NEW.sender_id THEN session_row.user_b ELSE session_row.user_a END;
  IF recipient_user_id = NEW.sender_id THEN RETURN NEW; END IF;
  PERFORM public.enqueue_push_notification(
    'random_message:' || NEW.id::text || ':' || recipient_user_id::text,
    'random_message', recipient_user_id, NEW.sender_id, NULL, NEW.id, NULL,
    'HerLink 有新訊息',
    CASE WHEN NEW.message_type = 'image' THEN '你收到一張圖片' ELSE '你收到一則新訊息' END,
    jsonb_build_object('type','message','session_id',NEW.session_id,'message_id',NEW.id,'target_url','/session/' || NEW.session_id::text,'kind','random_message'),
    NEW.session_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_random_match_push_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM public.enqueue_push_notification('random_match:' || NEW.id::text || ':' || NEW.user_a::text, 'random_match', NEW.user_a, NEW.user_b, NULL, NULL, NULL, 'HerLink 配對成功', '找到聊天對象了，點擊回到 HerLink。', jsonb_build_object('type','match','session_id',NEW.id,'target_url','/session/' || NEW.id::text,'kind','random_match'), NEW.id);
    PERFORM public.enqueue_push_notification('random_match:' || NEW.id::text || ':' || NEW.user_b::text, 'random_match', NEW.user_b, NEW.user_a, NULL, NULL, NULL, 'HerLink 配對成功', '找到聊天對象了，點擊回到 HerLink。', jsonb_build_object('type','match','session_id',NEW.id,'target_url','/session/' || NEW.id::text,'kind','random_match'), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
