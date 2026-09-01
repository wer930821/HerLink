-- HerLink Web v0.1: chat capacity hardening + private photo messages

-- 1) Message schema: support image messages (backwards compatible, text unchanged)
ALTER TABLE public.random_chat_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_size BIGINT,
  ADD COLUMN IF NOT EXISTS media_width INTEGER,
  ADD COLUMN IF NOT EXISTS media_height INTEGER;

ALTER TABLE public.random_chat_messages
  DROP CONSTRAINT IF EXISTS random_chat_messages_type_valid;
ALTER TABLE public.random_chat_messages
  ADD CONSTRAINT random_chat_messages_type_valid CHECK (message_type IN ('text', 'image'));

ALTER TABLE public.random_chat_messages
  DROP CONSTRAINT IF EXISTS random_chat_messages_media_valid;
ALTER TABLE public.random_chat_messages
  ADD CONSTRAINT random_chat_messages_media_valid CHECK (
    (
      message_type = 'text'
      AND media_path IS NULL
      AND media_mime IS NULL
      AND media_size IS NULL
    )
    OR
    (
      message_type = 'image'
      AND media_path IS NOT NULL
      AND media_mime IS NOT NULL
      AND media_size IS NOT NULL
      AND media_size > 0
      AND media_size <= 5242880
      AND media_mime IN ('image/jpeg', 'image/png', 'image/webp')
    )
  );

CREATE INDEX IF NOT EXISTS random_chat_messages_media_path_idx
  ON public.random_chat_messages (media_path)
  WHERE media_path IS NOT NULL;

-- 2) Media audit log (no image content, metadata only)
CREATE TABLE IF NOT EXISTS public.chat_media_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT,
  media_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS chat_media_audit_user_created_idx
  ON public.chat_media_audit (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_media_audit_session_created_idx
  ON public.chat_media_audit (session_id, created_at DESC);

ALTER TABLE public.chat_media_audit ENABLE ROW LEVEL SECURITY;

-- 3) Storage helper: safe session-id extraction from chat-media object paths
CREATE OR REPLACE FUNCTION public.chat_media_path_session_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  parts TEXT[];
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;

  parts := storage.foldername(p_name);
  IF array_length(parts, 1) < 2 THEN
    RETURN NULL;
  END IF;

  IF parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN parts[1]::uuid;
  EXCEPTION
    WHEN others THEN
      RETURN NULL;
  END;
END;
$$;

-- 4) Private bucket + storage policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS chat_media_insert_own_session ON storage.objects;
CREATE POLICY chat_media_insert_own_session
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND public.chat_media_path_session_id(name) IS NOT NULL
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS session_row
      WHERE session_row.id = public.chat_media_path_session_id(name)
        AND session_row.status = 'active'
        AND (session_row.user_a = auth.uid() OR session_row.user_b = auth.uid())
    )
  );

DROP POLICY IF EXISTS chat_media_select_session_member ON storage.objects;
CREATE POLICY chat_media_select_session_member
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND public.chat_media_path_session_id(name) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS session_row
      WHERE session_row.id = public.chat_media_path_session_id(name)
        AND (session_row.user_a = auth.uid() OR session_row.user_b = auth.uid())
    )
  );

-- 5) Cursor pagination: latest page first, then scroll-up history, then incremental after-cursor sync
DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.list_random_messages(
  p_session_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL,
  p_after_created_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  risk_level TEXT,
  risk_types TEXT[],
  message_type TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_size BIGINT,
  media_width INTEGER,
  media_height INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  max_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  paging_after BOOLEAN;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_random_session_member(p_session_id, actor_id) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  paging_after := p_after_created_at IS NOT NULL OR p_after_id IS NOT NULL;

  IF paging_after THEN
    RETURN QUERY
    SELECT
      message_row.id,
      message_row.session_id,
      message_row.content,
      message_row.created_at,
      message_row.sender_id = actor_id AS is_mine,
      COALESCE(message_row.risk_level, 'low') AS risk_level,
      COALESCE(message_row.risk_types, ARRAY[]::TEXT[]) AS risk_types,
      message_row.message_type,
      message_row.media_path,
      message_row.media_mime,
      message_row.media_size,
      message_row.media_width,
      message_row.media_height
    FROM public.random_chat_messages AS message_row
    WHERE message_row.session_id = p_session_id
      AND (
        message_row.created_at,
        message_row.id
      ) > (
        COALESCE(p_after_created_at, '-infinity'::timestamptz),
        COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    ORDER BY message_row.created_at ASC, message_row.id ASC
    LIMIT max_limit;
    RETURN;
  END IF;

  IF p_before_created_at IS NOT NULL OR p_before_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      older_row.id,
      older_row.session_id,
      older_row.content,
      older_row.created_at,
      older_row.sender_id = actor_id AS is_mine,
      COALESCE(older_row.risk_level, 'low') AS risk_level,
      COALESCE(older_row.risk_types, ARRAY[]::TEXT[]) AS risk_types,
      older_row.message_type,
      older_row.media_path,
      older_row.media_mime,
      older_row.media_size,
      older_row.media_width,
      older_row.media_height
    FROM (
      SELECT message_row.*
      FROM public.random_chat_messages AS message_row
      WHERE message_row.session_id = p_session_id
        AND (
          message_row.created_at,
          message_row.id
        ) < (
          COALESCE(p_before_created_at, 'infinity'::timestamptz),
          COALESCE(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
        )
      ORDER BY message_row.created_at DESC, message_row.id DESC
      LIMIT max_limit
    ) AS older_row
    ORDER BY older_row.created_at ASC, older_row.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    latest_row.id,
    latest_row.session_id,
    latest_row.content,
    latest_row.created_at,
    latest_row.sender_id = actor_id AS is_mine,
    COALESCE(latest_row.risk_level, 'low') AS risk_level,
    COALESCE(latest_row.risk_types, ARRAY[]::TEXT[]) AS risk_types,
    latest_row.message_type,
    latest_row.media_path,
    latest_row.media_mime,
    latest_row.media_size,
    latest_row.media_width,
    latest_row.media_height
  FROM (
    SELECT message_row.*
    FROM public.random_chat_messages AS message_row
    WHERE message_row.session_id = p_session_id
    ORDER BY message_row.created_at DESC, message_row.id DESC
    LIMIT max_limit
  ) AS latest_row
  ORDER BY latest_row.created_at ASC, latest_row.id ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_random_messages(UUID, INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID)
  TO authenticated, service_role;

-- 6) Media-aware send (text behavior preserved; image path fully server-validated)
DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.send_random_message(
  p_session_id UUID,
  p_content TEXT DEFAULT NULL,
  p_message_type TEXT DEFAULT 'text',
  p_media_path TEXT DEFAULT NULL,
  p_media_mime TEXT DEFAULT NULL,
  p_media_size BIGINT DEFAULT NULL,
  p_media_width INTEGER DEFAULT NULL,
  p_media_height INTEGER DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  risk_level TEXT,
  risk_types TEXT[],
  message_type TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_size BIGINT,
  media_width INTEGER,
  media_height INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  cleaned_content TEXT := btrim(COALESCE(p_content, ''));
  normalized_type TEXT := lower(btrim(COALESCE(p_message_type, 'text')));
  normalized_mime TEXT := lower(btrim(COALESCE(p_media_mime, '')));
  target_session RECORD;
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
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF normalized_type NOT IN ('text', 'image') THEN
    RAISE EXCEPTION 'Unsupported message type.';
  END IF;

  PERFORM public.reconcile_profile_enforcement_status(actor_id);

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not available.';
  END IF;

  SELECT session_row.id, session_row.status
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND session_row.status = 'active'
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  IF normalized_type = 'image' THEN
    PERFORM public.check_random_action_rate_limit(
      'send_image_message',
      3,
      INTERVAL '1 minute',
      jsonb_build_object('session_id', p_session_id::TEXT)
    );

    PERFORM public.check_random_action_rate_limit(
      'send_image_message_daily',
      30,
      INTERVAL '24 hours',
      jsonb_build_object('session_id', p_session_id::TEXT)
    );

    IF normalized_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path)
      VALUES (actor_id, p_session_id, 'invalid_mime', normalized_mime, p_media_path);
      RAISE EXCEPTION 'Unsupported media type.';
    END IF;

    IF COALESCE(p_media_size, 0) < 1 OR COALESCE(p_media_size, 0) > 5242880 THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path, metadata)
      VALUES (
        actor_id,
        p_session_id,
        'invalid_size',
        'media_size_out_of_range',
        p_media_path,
        jsonb_build_object('declared_size', p_media_size)
      );
      RAISE EXCEPTION 'Media size is not allowed.';
    END IF;

    IF COALESCE(p_media_width, 0) < 1
      OR COALESCE(p_media_width, 0) > 8192
      OR COALESCE(p_media_height, 0) < 1
      OR COALESCE(p_media_height, 0) > 8192 THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path)
      VALUES (actor_id, p_session_id, 'invalid_dimensions', 'dimensions_out_of_range', p_media_path);
      RAISE EXCEPTION 'Media dimensions are not allowed.';
    END IF;

    media_path_prefix := p_session_id::TEXT || '/' || actor_id::TEXT || '/';
    IF p_media_path IS NULL
      OR left(p_media_path, length(media_path_prefix)) <> media_path_prefix
      OR public.chat_media_path_session_id(p_media_path) IS DISTINCT FROM p_session_id THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path)
      VALUES (actor_id, p_session_id, 'unauthorized_path', 'media_path_not_owned', p_media_path);
      RAISE EXCEPTION 'Media path is not allowed.';
    END IF;

    SELECT
      COALESCE((object_row.metadata->>'size')::BIGINT, 0),
      lower(COALESCE(object_row.metadata->>'mimetype', ''))
    INTO actual_size, actual_mime
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-media'
      AND object_row.name = p_media_path
    LIMIT 1;

    object_found := FOUND;

    IF NOT object_found THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path)
      VALUES (actor_id, p_session_id, 'missing_object', 'media_object_not_found', p_media_path);
      RAISE EXCEPTION 'Media file was not found.';
    END IF;

    IF actual_size <> p_media_size OR actual_mime <> normalized_mime THEN
      INSERT INTO public.chat_media_audit (user_id, session_id, action, reason, media_path, metadata)
      VALUES (
        actor_id,
        p_session_id,
        'object_mismatch',
        'media_metadata_mismatch',
        p_media_path,
        jsonb_build_object(
          'actual_size', actual_size,
          'declared_size', p_media_size,
          'actual_mime', actual_mime
        )
      );
      RAISE EXCEPTION 'Media file does not match.';
    END IF;

    RETURN QUERY
    INSERT INTO public.random_chat_messages AS message_row (
      session_id,
      sender_id,
      content,
      risk_level,
      risk_types,
      message_type,
      media_path,
      media_mime,
      media_size,
      media_width,
      media_height
    )
    VALUES (
      p_session_id,
      actor_id,
      '[圖片]',
      'low',
      ARRAY[]::TEXT[],
      'image',
      p_media_path,
      normalized_mime,
      p_media_size,
      p_media_width,
      p_media_height
    )
    RETURNING
      message_row.id,
      message_row.session_id,
      message_row.content,
      message_row.created_at,
      TRUE,
      message_row.risk_level,
      message_row.risk_types,
      message_row.message_type,
      message_row.media_path,
      message_row.media_mime,
      message_row.media_size,
      message_row.media_width,
      message_row.media_height;
    RETURN;
  END IF;

  -- text path (unchanged behavior)
  IF cleaned_content = '' THEN
    RAISE EXCEPTION 'Message cannot be blank.';
  END IF;

  IF length(cleaned_content) > 2000 THEN
    RAISE EXCEPTION 'Message is too long.';
  END IF;

  PERFORM public.check_random_action_rate_limit(
    'send_random_message',
    5,
    INTERVAL '10 seconds',
    jsonb_build_object('session_id', p_session_id::TEXT)
  );

  SELECT risk_row.risk_level, risk_row.risk_types
  INTO detected_risk_level, detected_risk_types
  FROM public.analyze_random_message_risk(cleaned_content) AS risk_row;

  SELECT EXISTS (
    SELECT 1
    FROM public.random_chat_messages AS message_row
    WHERE message_row.session_id = p_session_id
      AND message_row.sender_id = actor_id
      AND message_row.content = cleaned_content
      AND message_row.created_at >= timezone('utc'::text, now()) - INTERVAL '30 seconds'
  )
  INTO repeated_message;

  IF repeated_message THEN
    detected_risk_types := array_append(detected_risk_types, 'repeated_message');
    IF detected_risk_level = 'low' THEN
      detected_risk_level := 'medium';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(item), ARRAY[]::TEXT[])
  INTO detected_risk_types
  FROM (
    SELECT DISTINCT item
    FROM unnest(detected_risk_types) AS item
    ORDER BY item
  ) AS deduped_types;

  RETURN QUERY
  INSERT INTO public.random_chat_messages AS message_row (
    session_id,
    sender_id,
    content,
    risk_level,
    risk_types,
    message_type
  )
  VALUES (
    p_session_id,
    actor_id,
    cleaned_content,
    detected_risk_level,
    detected_risk_types,
    'text'
  )
  RETURNING
    message_row.id,
    message_row.session_id,
    message_row.content,
    message_row.created_at,
    TRUE,
    message_row.risk_level,
    message_row.risk_types,
    message_row.message_type,
    message_row.media_path,
    message_row.media_mime,
    message_row.media_size,
    message_row.media_width,
    message_row.media_height;

  SELECT message_row.id, message_row.created_at
  INTO inserted_message_id, inserted_created_at
  FROM public.random_chat_messages AS message_row
  WHERE message_row.session_id = p_session_id
    AND message_row.sender_id = actor_id
    AND message_row.content = cleaned_content
  ORDER BY message_row.created_at DESC, message_row.id DESC
  LIMIT 1;

  IF detected_risk_level <> 'low' THEN
    INSERT INTO public.fraud_risk_events (
      user_id,
      session_id,
      message_id,
      risk_level,
      risk_types,
      created_at
    )
    VALUES (
      actor_id,
      p_session_id,
      inserted_message_id,
      detected_risk_level,
      detected_risk_types,
      COALESCE(inserted_created_at, timezone('utc'::text, now()))
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_random_message(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER)
  TO authenticated, service_role;

-- 7) Cleanup helpers (service_role / scheduled)
CREATE OR REPLACE FUNCTION public.cleanup_chat_media_orphans(p_max_age INTERVAL DEFAULT INTERVAL '1 hour')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INTEGER := 0;
  orphan_row RECORD;
BEGIN
  FOR orphan_row IN
    SELECT object_row.name
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-media'
      AND object_row.created_at < timezone('utc'::text, now()) - COALESCE(p_max_age, INTERVAL '1 hour')
      AND NOT EXISTS (
        SELECT 1
        FROM public.random_chat_messages AS message_row
        WHERE message_row.message_type = 'image'
          AND message_row.media_path = object_row.name
      )
  LOOP
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-media'
      AND name = orphan_row.name;
    removed := removed + 1;
  END LOOP;

  RETURN removed;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_random_queue(p_max_age INTERVAL DEFAULT INTERVAL '24 hours')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned INTEGER := 0;
BEGIN
  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE status = 'waiting'
    AND updated_at < timezone('utc'::text, now()) - COALESCE(p_max_age, INTERVAL '24 hours');

  GET DIAGNOSTICS cleaned = ROW_COUNT;
  RETURN cleaned;
END;
$$;

CREATE INDEX IF NOT EXISTS random_match_queue_status_updated_idx
  ON public.random_match_queue (status, updated_at);

GRANT EXECUTE ON FUNCTION public.cleanup_chat_media_orphans(INTERVAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_random_queue(INTERVAL) TO service_role;
