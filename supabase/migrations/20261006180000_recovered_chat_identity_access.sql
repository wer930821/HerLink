CREATE OR REPLACE FUNCTION public.resolve_active_anonymous_chat_identity()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(
    (SELECT anonymous_identity_id FROM public.anonymous_identity_device_state WHERE active_auth_user_id=auth.uid() LIMIT 1),
    CASE
      WHEN EXISTS(SELECT 1 FROM public.anonymous_identity_device_state WHERE anonymous_identity_id=auth.uid()) THEN NULL
      ELSE auth.uid()
    END
  );
$$;
REVOKE ALL ON FUNCTION public.resolve_active_anonymous_chat_identity() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_active_anonymous_chat_identity() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.is_active_random_session_member(p_session_id UUID,p_required_status TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.random_chat_sessions session_row
    CROSS JOIN LATERAL (SELECT public.resolve_active_anonymous_chat_identity() AS identity_id) actor
    WHERE session_row.id=p_session_id
      AND actor.identity_id IS NOT NULL
      AND (session_row.user_a=identity_id OR session_row.user_b=identity_id)
      AND (p_required_status IS NULL OR session_row.status=p_required_status)
  );
$$;
REVOKE ALL ON FUNCTION public.is_active_random_session_member(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_active_random_session_member(UUID,TEXT) TO authenticated,service_role;

DROP POLICY IF EXISTS random_chat_messages_select_participant ON public.random_chat_messages;
CREATE POLICY random_chat_messages_select_participant ON public.random_chat_messages FOR SELECT TO authenticated USING (
  EXISTS(
    SELECT 1 FROM public.random_chat_sessions session_row
    CROSS JOIN LATERAL (SELECT public.resolve_active_anonymous_chat_identity() AS identity_id) actor
    WHERE session_row.id=random_chat_messages.session_id
      AND actor.identity_id IS NOT NULL
      AND (session_row.user_a=identity_id OR session_row.user_b=identity_id)
  )
);

CREATE OR REPLACE FUNCTION public.list_random_messages(p_session_id UUID,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,session_id UUID,sender_id UUID,content TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE identity_id UUID:=public.resolve_active_anonymous_chat_identity(); max_limit INTEGER:=LEAST(GREATEST(COALESCE(p_limit,100),1),200);
BEGIN
  IF auth.uid() IS NULL OR identity_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF;
  PERFORM public.reconcile_profile_enforcement_status(identity_id);
  IF NOT public.is_profile_eligible(identity_id) THEN RAISE EXCEPTION 'Your account is not available.'; END IF;
  IF NOT public.is_active_random_session_member(p_session_id,NULL) THEN RAISE EXCEPTION 'This session is not available.'; END IF;
  RETURN QUERY SELECT m.id,m.session_id,m.sender_id,m.content,m.created_at FROM public.random_chat_messages m WHERE m.session_id=p_session_id ORDER BY m.created_at ASC,m.id ASC LIMIT max_limit;
END; $$;

CREATE OR REPLACE FUNCTION public.send_random_message(p_session_id UUID,p_content TEXT)
RETURNS TABLE(id UUID,session_id UUID,sender_id UUID,content TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE identity_id UUID:=public.resolve_active_anonymous_chat_identity(); cleaned_content TEXT:=btrim(COALESCE(p_content,''));
BEGIN
  IF auth.uid() IS NULL OR identity_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF;
  IF cleaned_content='' THEN RAISE EXCEPTION 'Message cannot be blank.'; END IF;
  IF length(cleaned_content)>2000 THEN RAISE EXCEPTION 'Message is too long.'; END IF;
  PERFORM public.reconcile_profile_enforcement_status(identity_id);
  IF NOT public.is_profile_eligible(identity_id) THEN RAISE EXCEPTION 'Your account is not available.'; END IF;
  IF NOT public.is_active_random_session_member(p_session_id,'active') THEN RAISE EXCEPTION 'This session is not available.'; END IF;
  RETURN QUERY INSERT INTO public.random_chat_messages(session_id,sender_id,content) VALUES (p_session_id,identity_id,cleaned_content)
    RETURNING random_chat_messages.id,random_chat_messages.session_id,random_chat_messages.sender_id,random_chat_messages.content,random_chat_messages.created_at;
END; $$;

GRANT EXECUTE ON FUNCTION public.list_random_messages(UUID,INTEGER) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.send_random_message(UUID,TEXT) TO authenticated,service_role;
