-- Preserve the current media/reply RPC contract while authorizing chats through
-- the stable anonymous identity recovered onto the current auth principal.

CREATE OR REPLACE FUNCTION public.get_random_message_reply_preview(
  p_session_id UUID,
  p_message_id UUID
)
RETURNS TABLE (
  reply_message_id UUID,
  reply_is_mine BOOLEAN,
  reply_message_type TEXT,
  reply_body TEXT,
  reply_media_path TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.is_random_session_member(p_session_id, actor_id) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  RETURN QUERY
  SELECT target_row.id,
         target_row.sender_id = actor_id,
         target_row.message_type,
         CASE WHEN target_row.message_type = 'image' THEN NULL ELSE target_row.content END,
         target_row.media_path
  FROM public.random_chat_messages target_row
  WHERE target_row.id = p_message_id AND target_row.session_id = p_session_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_message_reply_preview(UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID);
CREATE OR REPLACE FUNCTION public.list_random_messages(
  p_session_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, session_id UUID, content TEXT, created_at TIMESTAMPTZ, is_mine BOOLEAN,
  risk_level TEXT, risk_types TEXT[], message_type TEXT, media_path TEXT, media_mime TEXT,
  media_size BIGINT, media_width INTEGER, media_height INTEGER, reply_to_message_id UUID,
  reply_message_id UUID, reply_is_mine BOOLEAN, reply_message_type TEXT,
  reply_body TEXT, reply_media_path TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
  max_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  paging_after BOOLEAN;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT public.is_random_session_member(p_session_id, actor_id) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;
  paging_after := p_after_created_at IS NOT NULL OR p_after_id IS NOT NULL;

  IF paging_after THEN
    RETURN QUERY
    SELECT m.id,m.session_id,m.content,m.created_at,m.sender_id=actor_id,
           COALESCE(m.risk_level,'low'),COALESCE(m.risk_types,ARRAY[]::TEXT[]),
           m.message_type,m.media_path,m.media_mime,m.media_size,m.media_width,m.media_height,
           m.reply_to_message_id,r.id,r.sender_id=actor_id,r.message_type,
           CASE WHEN r.message_type='image' THEN NULL ELSE r.content END,r.media_path
    FROM public.random_chat_messages m
    LEFT JOIN public.random_chat_messages r ON r.id=m.reply_to_message_id
    WHERE m.session_id=p_session_id
      AND (m.created_at,m.id) > (COALESCE(p_after_created_at,'-infinity'::timestamptz),COALESCE(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid))
    ORDER BY m.created_at ASC,m.id ASC LIMIT max_limit;
    RETURN;
  END IF;

  IF p_before_created_at IS NOT NULL OR p_before_id IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id,m.session_id,m.content,m.created_at,m.sender_id=actor_id,
           COALESCE(m.risk_level,'low'),COALESCE(m.risk_types,ARRAY[]::TEXT[]),
           m.message_type,m.media_path,m.media_mime,m.media_size,m.media_width,m.media_height,
           m.reply_to_message_id,r.id,r.sender_id=actor_id,r.message_type,
           CASE WHEN r.message_type='image' THEN NULL ELSE r.content END,r.media_path
    FROM (
      SELECT x.* FROM public.random_chat_messages x
      WHERE x.session_id=p_session_id
        AND (x.created_at,x.id) < (COALESCE(p_before_created_at,'infinity'::timestamptz),COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      ORDER BY x.created_at DESC,x.id DESC LIMIT max_limit
    ) m
    LEFT JOIN public.random_chat_messages r ON r.id=m.reply_to_message_id
    ORDER BY m.created_at ASC,m.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id,m.session_id,m.content,m.created_at,m.sender_id=actor_id,
         COALESCE(m.risk_level,'low'),COALESCE(m.risk_types,ARRAY[]::TEXT[]),
         m.message_type,m.media_path,m.media_mime,m.media_size,m.media_width,m.media_height,
         m.reply_to_message_id,r.id,r.sender_id=actor_id,r.message_type,
         CASE WHEN r.message_type='image' THEN NULL ELSE r.content END,r.media_path
  FROM (
    SELECT x.* FROM public.random_chat_messages x WHERE x.session_id=p_session_id
    ORDER BY x.created_at DESC,x.id DESC LIMIT max_limit
  ) m
  LEFT JOIN public.random_chat_messages r ON r.id=m.reply_to_message_id
  ORDER BY m.created_at ASC,m.id ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_random_messages(UUID, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.send_random_message(
  p_session_id UUID,
  p_content TEXT DEFAULT NULL,
  p_message_type TEXT DEFAULT 'text',
  p_media_path TEXT DEFAULT NULL,
  p_media_mime TEXT DEFAULT NULL,
  p_media_size BIGINT DEFAULT NULL,
  p_media_width INTEGER DEFAULT NULL,
  p_media_height INTEGER DEFAULT NULL,
  p_reply_to_message_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, session_id UUID, content TEXT, created_at TIMESTAMPTZ, is_mine BOOLEAN,
  risk_level TEXT, risk_types TEXT[], message_type TEXT, media_path TEXT, media_mime TEXT,
  media_size BIGINT, media_width INTEGER, media_height INTEGER, reply_to_message_id UUID,
  reply_message_id UUID, reply_is_mine BOOLEAN, reply_message_type TEXT,
  reply_body TEXT, reply_media_path TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
  auth_user_id UUID := auth.uid();
  cleaned_content TEXT := btrim(COALESCE(p_content,''));
  normalized_type TEXT := lower(btrim(COALESCE(p_message_type,'text')));
  normalized_mime TEXT := lower(btrim(COALESCE(p_media_mime,'')));
  detected_risk_level TEXT := 'low';
  detected_risk_types TEXT[] := ARRAY[]::TEXT[];
  repeated_message BOOLEAN := FALSE;
  inserted_message_id UUID;
  inserted_created_at TIMESTAMPTZ;
  actual_size BIGINT := 0;
  actual_mime TEXT := '';
  object_found BOOLEAN := FALSE;
  media_path_prefix TEXT;
BEGIN
  IF actor_id IS NULL OR auth_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF normalized_type NOT IN ('text','image') THEN RAISE EXCEPTION 'Unsupported message type.'; END IF;

  PERFORM public.reconcile_profile_enforcement_status(actor_id);
  IF NOT public.is_profile_eligible(actor_id) THEN RAISE EXCEPTION 'Your account is not available.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.random_chat_sessions s
    WHERE s.id=p_session_id AND s.status='active' AND (s.user_a=actor_id OR s.user_b=actor_id)
  ) THEN RAISE EXCEPTION 'This session is not available.'; END IF;

  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.random_chat_messages t
    WHERE t.id=p_reply_to_message_id AND t.session_id=p_session_id
  ) THEN RAISE EXCEPTION 'Reply target is not available.'; END IF;

  IF normalized_type='image' THEN
    PERFORM public.check_random_action_rate_limit('send_image_message',3,INTERVAL '1 minute',jsonb_build_object('session_id',p_session_id::TEXT));
    PERFORM public.check_random_action_rate_limit('send_image_message_daily',30,INTERVAL '24 hours',jsonb_build_object('session_id',p_session_id::TEXT));

    IF normalized_mime NOT IN ('image/jpeg','image/png','image/webp') THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path)
      VALUES(actor_id,p_session_id,'invalid_mime',normalized_mime,p_media_path);
      RAISE EXCEPTION 'Unsupported media type.';
    END IF;
    IF COALESCE(p_media_size,0)<1 OR COALESCE(p_media_size,0)>5242880 THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path,metadata)
      VALUES(actor_id,p_session_id,'invalid_size','media_size_out_of_range',p_media_path,jsonb_build_object('declared_size',p_media_size));
      RAISE EXCEPTION 'Media size is not allowed.';
    END IF;
    IF COALESCE(p_media_width,0)<1 OR COALESCE(p_media_width,0)>8192 OR COALESCE(p_media_height,0)<1 OR COALESCE(p_media_height,0)>8192 THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path)
      VALUES(actor_id,p_session_id,'invalid_dimensions','dimensions_out_of_range',p_media_path);
      RAISE EXCEPTION 'Media dimensions are not allowed.';
    END IF;

    -- Storage ownership stays bound to the currently authenticated device principal;
    -- chat authorship stays bound to the stable recovered anonymous identity.
    media_path_prefix := p_session_id::TEXT || '/' || auth_user_id::TEXT || '/';
    IF p_media_path IS NULL OR left(p_media_path,length(media_path_prefix))<>media_path_prefix
       OR public.chat_media_path_session_id(p_media_path) IS DISTINCT FROM p_session_id THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path)
      VALUES(actor_id,p_session_id,'unauthorized_path','media_path_not_owned',p_media_path);
      RAISE EXCEPTION 'Media path is not allowed.';
    END IF;

    SELECT COALESCE((o.metadata->>'size')::BIGINT,0),lower(COALESCE(o.metadata->>'mimetype',''))
      INTO actual_size,actual_mime
    FROM storage.objects o WHERE o.bucket_id='chat-media' AND o.name=p_media_path LIMIT 1;
    object_found := FOUND;
    IF NOT object_found THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path)
      VALUES(actor_id,p_session_id,'missing_object','media_object_not_found',p_media_path);
      RAISE EXCEPTION 'Media file was not found.';
    END IF;
    IF actual_size<>p_media_size OR actual_mime<>normalized_mime THEN
      INSERT INTO public.chat_media_audit(user_id,session_id,action,reason,media_path,metadata)
      VALUES(actor_id,p_session_id,'object_mismatch','media_metadata_mismatch',p_media_path,
        jsonb_build_object('actual_size',actual_size,'declared_size',p_media_size,'actual_mime',actual_mime));
      RAISE EXCEPTION 'Media file does not match.';
    END IF;

    INSERT INTO public.random_chat_messages(session_id,sender_id,content,risk_level,risk_types,message_type,media_path,media_mime,media_size,media_width,media_height,reply_to_message_id)
    VALUES(p_session_id,actor_id,'[圖片]','low',ARRAY[]::TEXT[],'image',p_media_path,normalized_mime,p_media_size,p_media_width,p_media_height,p_reply_to_message_id)
    RETURNING random_chat_messages.id INTO inserted_message_id;
  ELSE
    IF cleaned_content='' THEN RAISE EXCEPTION 'Message cannot be blank.'; END IF;
    IF length(cleaned_content)>2000 THEN RAISE EXCEPTION 'Message is too long.'; END IF;
    PERFORM public.check_random_action_rate_limit('send_random_message',5,INTERVAL '10 seconds',jsonb_build_object('session_id',p_session_id::TEXT));
    SELECT r.risk_level,r.risk_types INTO detected_risk_level,detected_risk_types
      FROM public.analyze_random_message_risk(cleaned_content) r;
    SELECT EXISTS(SELECT 1 FROM public.random_chat_messages m
      WHERE m.session_id=p_session_id AND m.sender_id=actor_id AND m.content=cleaned_content
        AND m.created_at>=timezone('utc'::text,now())-INTERVAL '30 seconds') INTO repeated_message;
    IF repeated_message THEN
      detected_risk_types:=array_append(detected_risk_types,'repeated_message');
      IF detected_risk_level='low' THEN detected_risk_level:='medium'; END IF;
    END IF;
    SELECT COALESCE(array_agg(item),ARRAY[]::TEXT[]) INTO detected_risk_types
      FROM (SELECT DISTINCT item FROM unnest(detected_risk_types) item ORDER BY item) d;
    INSERT INTO public.random_chat_messages(session_id,sender_id,content,risk_level,risk_types,message_type,reply_to_message_id)
    VALUES(p_session_id,actor_id,cleaned_content,detected_risk_level,detected_risk_types,'text',p_reply_to_message_id)
    RETURNING random_chat_messages.id,random_chat_messages.created_at INTO inserted_message_id,inserted_created_at;
  END IF;

  RETURN QUERY
  SELECT m.id,m.session_id,m.content,m.created_at,TRUE,m.risk_level,m.risk_types,m.message_type,
         m.media_path,m.media_mime,m.media_size,m.media_width,m.media_height,m.reply_to_message_id,
         r.id,r.sender_id=actor_id,r.message_type,CASE WHEN r.message_type='image' THEN NULL ELSE r.content END,r.media_path
  FROM public.random_chat_messages m LEFT JOIN public.random_chat_messages r ON r.id=m.reply_to_message_id
  WHERE m.id=inserted_message_id;

  IF normalized_type='text' AND detected_risk_level<>'low' THEN
    INSERT INTO public.fraud_risk_events(user_id,session_id,message_id,risk_level,risk_types,created_at)
    VALUES(actor_id,p_session_id,inserted_message_id,detected_risk_level,detected_risk_types,
      COALESCE(inserted_created_at,timezone('utc'::text,now())));
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_random_message(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER, UUID) TO authenticated, service_role;
