ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_category_valid;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_category_valid CHECK (
    category IN (
      'suspected_male_impersonation',
      'stolen_photo',
      'scam',
      'money_request',
      'investment_scam',
      'harassment',
      'sexual_harassment',
      'threat',
      'unsolicited_explicit_content',
      'impersonation',
      'suspected_minor',
      'other',
      'spam',
      'sexual_content',
      'fraud'
    )
  );

ALTER TABLE public.random_chat_messages
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS risk_types TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_my_random_session_view(UUID);
DROP FUNCTION IF EXISTS public.block_random_user(UUID);
DROP FUNCTION IF EXISTS public.report_random_user(UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.check_random_action_rate_limit(TEXT, INTEGER, INTERVAL, JSONB);
DROP FUNCTION IF EXISTS public.analyze_random_message_risk(TEXT);

CREATE TABLE IF NOT EXISTS public.random_action_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS random_action_rate_limit_events_user_action_idx
  ON public.random_action_rate_limit_events (user_id, action_key, created_at DESC);

CREATE INDEX IF NOT EXISTS random_action_rate_limit_events_action_idx
  ON public.random_action_rate_limit_events (action_key, created_at DESC);

ALTER TABLE public.random_action_rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fraud_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.random_chat_messages(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL,
  risk_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT fraud_risk_events_level_valid CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS fraud_risk_events_user_id_idx
  ON public.fraud_risk_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_risk_events_session_id_idx
  ON public.fraud_risk_events (session_id, created_at DESC);

ALTER TABLE public.fraud_risk_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_random_action_rate_limit(
  p_action_key TEXT,
  p_limit_count INTEGER,
  p_window INTERVAL,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  recent_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF btrim(COALESCE(p_action_key, '')) = '' THEN
    RAISE EXCEPTION 'Action key is required.';
  END IF;

  IF COALESCE(p_limit_count, 0) < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit.';
  END IF;

  IF COALESCE(p_window, INTERVAL '0 seconds') <= INTERVAL '0 seconds' THEN
    RAISE EXCEPTION 'Invalid rate window.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('herlink.random.rate:' || actor_id::TEXT || ':' || p_action_key, 0)
  );

  SELECT COUNT(*)
  INTO recent_count
  FROM public.random_action_rate_limit_events AS rate_row
  WHERE rate_row.user_id = actor_id
    AND rate_row.action_key = p_action_key
    AND rate_row.created_at >= timezone('utc'::text, now()) - p_window;

  IF recent_count >= p_limit_count THEN
    RAISE EXCEPTION 'Rate limit exceeded.';
  END IF;

  INSERT INTO public.random_action_rate_limit_events (user_id, action_key, context, created_at)
  VALUES (actor_id, p_action_key, COALESCE(p_context, '{}'::jsonb), timezone('utc'::text, now()));
END;
$$;

CREATE OR REPLACE FUNCTION public.analyze_random_message_risk(p_content TEXT)
RETURNS TABLE (
  risk_level TEXT,
  risk_types TEXT[]
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  normalized_content TEXT := lower(btrim(COALESCE(p_content, '')));
  detected_types TEXT[] := ARRAY[]::TEXT[];
  has_high BOOLEAN := FALSE;
  has_medium BOOLEAN := FALSE;
BEGIN
  IF normalized_content = '' THEN
    RETURN QUERY SELECT 'low'::TEXT, ARRAY[]::TEXT[];
    RETURN;
  END IF;

  IF normalized_content ~ '(https?://|www\.|javascript:|data:text/html)' THEN
    detected_types := array_append(detected_types, 'suspicious_external_link');
    has_medium := TRUE;
  END IF;

  IF normalized_content ~ '(驗證碼|otp|一次性密碼|一次性驗證碼|簡訊驗證碼|verification code)' THEN
    detected_types := array_append(detected_types, 'credential_request');
    has_high := TRUE;
  END IF;

  IF normalized_content ~ '(匯款|轉帳|現金|代收|付我|幫我付|借我錢|收款|付款|收錢|pay me|wire)' THEN
    detected_types := array_append(detected_types, 'suspicious_money_message');
    has_high := TRUE;
  END IF;

  IF normalized_content ~ '(投資|保證獲利|穩賺|跟單|usdt|虛擬幣|幣圈|老師帶單|返利|高報酬)' THEN
    detected_types := array_append(detected_types, 'suspicious_investment_message');
    has_high := TRUE;
  END IF;

  IF normalized_content ~ '(line id|telegram|discord|whatsapp|wechat|加我line|加我 ig|ig帳號)' THEN
    detected_types := array_append(detected_types, 'off_platform_contact');
    has_medium := TRUE;
  END IF;

  SELECT COALESCE(array_agg(item), ARRAY[]::TEXT[])
  INTO detected_types
  FROM (
    SELECT DISTINCT item
    FROM unnest(detected_types) AS item
    ORDER BY item
  ) AS deduped_types;

  IF has_high THEN
    risk_level := 'high';
  ELSIF has_medium THEN
    risk_level := 'medium';
  ELSE
    risk_level := 'low';
  END IF;

  RETURN QUERY SELECT risk_level, detected_types;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_random_session_view(p_session_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  status TEXT,
  created_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  ended_by_me BOOLEAN,
  partner_anonymous_display_name TEXT,
  partner_anonymous_avatar TEXT,
  partner_verified BOOLEAN,
  partner_age_display TEXT,
  partner_city TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    session_row.id,
    session_row.status,
    session_row.created_at,
    session_row.ended_at,
    session_row.ended_reason,
    session_row.ended_by = auth.uid() AS ended_by_me,
    COALESCE(partner.anonymous_display_name, '匿名使用者') AS partner_anonymous_display_name,
    COALESCE(partner.anonymous_avatar, 'avatar_01') AS partner_anonymous_avatar,
    COALESCE(partner.verified, FALSE) AS partner_verified,
    partner.age_display AS partner_age_display,
    partner.city AS partner_city
  FROM public.random_chat_sessions AS session_row
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.get_safe_anonymous_profiles(ARRAY[
      CASE
        WHEN session_row.user_a = auth.uid() THEN session_row.user_b
        ELSE session_row.user_a
      END
    ])
    LIMIT 1
  ) AS partner ON TRUE
  WHERE auth.uid() IS NOT NULL
    AND (p_session_id IS NULL OR session_row.id = p_session_id)
    AND (session_row.user_a = auth.uid() OR session_row.user_b = auth.uid())
    AND (p_session_id IS NOT NULL OR session_row.status = 'active')
  ORDER BY session_row.created_at DESC, session_row.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.block_random_user(p_session_id UUID)
RETURNS TABLE (
  blocked BOOLEAN,
  session_ended BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_session RECORD;
  target_user_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session is required.';
  END IF;

  SELECT session_row.id, session_row.user_a, session_row.user_b, session_row.status
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  target_user_id := CASE
    WHEN target_session.user_a = actor_id THEN target_session.user_b
    ELSE target_session.user_a
  END;

  PERFORM public.block_user(target_user_id);

  UPDATE public.random_chat_sessions AS session_row
  SET status = 'ended',
      ended_at = timezone('utc'::text, now()),
      ended_by = actor_id,
      ended_reason = 'blocked'
  WHERE session_row.id = p_session_id
    AND session_row.status = 'active'
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id);

  RETURN QUERY SELECT TRUE, FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_random_user(
  p_session_id UUID,
  p_category TEXT,
  p_description TEXT DEFAULT NULL,
  p_block BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  report_id UUID,
  report_status TEXT,
  created_at TIMESTAMPTZ,
  blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_session RECORD;
  target_user_id UUID;
  normalized_description TEXT := NULLIF(BTRIM(COALESCE(p_description, '')), '');
  block_result RECORD;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.id = p_session_id
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  ) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  IF p_category NOT IN (
    'suspected_male_impersonation',
    'stolen_photo',
    'scam',
    'money_request',
    'investment_scam',
    'harassment',
    'sexual_harassment',
    'threat',
    'unsolicited_explicit_content',
    'impersonation',
    'suspected_minor',
    'other',
    'spam',
    'sexual_content',
    'fraud'
  ) THEN
    RAISE EXCEPTION 'Unsupported report category.';
  END IF;

  IF normalized_description IS NOT NULL AND length(normalized_description) > 500 THEN
    RAISE EXCEPTION 'Report description is too long.';
  END IF;

  PERFORM public.check_random_action_rate_limit(
    'report_random_user',
    5,
    INTERVAL '10 minutes',
    jsonb_build_object('session_id', p_session_id::TEXT, 'category', p_category)
  );

  SELECT session_row.id, session_row.user_a, session_row.user_b
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  target_user_id := CASE
    WHEN target_session.user_a = actor_id THEN target_session.user_b
    ELSE target_session.user_a
  END;

  SELECT existing_report.id, existing_report.status, existing_report.created_at
  INTO report_id, report_status, created_at
  FROM public.reports AS existing_report
  WHERE existing_report.reporter_id = actor_id
    AND existing_report.reported_user_id = target_user_id
    AND existing_report.category = p_category
    AND COALESCE(existing_report.description, '') = COALESCE(normalized_description, '')
    AND existing_report.created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
  ORDER BY existing_report.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    blocked := FALSE;
  ELSE
    INSERT INTO public.reports AS report_row (reporter_id, reported_user_id, category, description, status)
    VALUES (
      actor_id,
      target_user_id,
      p_category,
      normalized_description,
      'pending'
    )
    RETURNING report_row.id, report_row.status, report_row.created_at
    INTO report_id, report_status, created_at;
    blocked := FALSE;
  END IF;

  IF p_block THEN
    BEGIN
      SELECT result.blocked, result.session_ended
      INTO block_result
      FROM public.block_random_user(p_session_id) AS result;
      blocked := COALESCE(block_result.blocked, FALSE);
    EXCEPTION
      WHEN OTHERS THEN
        blocked := FALSE;
    END;
  END IF;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_random_message(
  p_session_id UUID,
  p_content TEXT
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  risk_level TEXT,
  risk_types TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  cleaned_content TEXT := btrim(COALESCE(p_content, ''));
  target_session RECORD;
  detected_risk_level TEXT := 'low';
  detected_risk_types TEXT[] := ARRAY[]::TEXT[];
  repeated_message BOOLEAN := FALSE;
  inserted_message_id UUID;
  inserted_created_at TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF cleaned_content = '' THEN
    RAISE EXCEPTION 'Message cannot be blank.';
  END IF;

  IF length(cleaned_content) > 2000 THEN
    RAISE EXCEPTION 'Message is too long.';
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
    risk_types
  )
  VALUES (
    p_session_id,
    actor_id,
    cleaned_content,
    detected_risk_level,
    detected_risk_types
  )
  RETURNING
    message_row.id,
    message_row.session_id,
    message_row.content,
    message_row.created_at,
    TRUE,
    message_row.risk_level,
    message_row.risk_types;

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

CREATE OR REPLACE FUNCTION public.list_random_messages(
  p_session_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_mine BOOLEAN,
  risk_level TEXT,
  risk_types TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  max_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_random_session_member(p_session_id, actor_id) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  RETURN QUERY
  SELECT
    message_row.id,
    message_row.session_id,
    message_row.content,
    message_row.created_at,
    message_row.sender_id = actor_id AS is_mine,
    COALESCE(message_row.risk_level, 'low') AS risk_level,
    COALESCE(message_row.risk_types, ARRAY[]::TEXT[]) AS risk_types
  FROM public.random_chat_messages AS message_row
  WHERE message_row.session_id = p_session_id
  ORDER BY message_row.created_at ASC, message_row.id ASC
  LIMIT max_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_random_match(
  p_session_id UUID
)
RETURNS TABLE (
  status TEXT,
  session_id UUID,
  matched_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_session RECORD;
  other_participant UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT session_row.id, session_row.status, session_row.user_a, session_row.user_b
  INTO target_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.id = p_session_id
    AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  PERFORM public.check_random_action_rate_limit(
    'next_random_match',
    3,
    INTERVAL '20 seconds',
    jsonb_build_object('session_id', p_session_id::TEXT)
  );

  other_participant := CASE
    WHEN target_session.user_a = actor_id THEN target_session.user_b
    ELSE target_session.user_a
  END;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));

  IF target_session.status = 'active' THEN
    UPDATE public.random_chat_sessions AS session_row
    SET status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'next'
    WHERE session_row.id = p_session_id
      AND session_row.status = 'active'
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This session is not available.';
    END IF;
  END IF;

  UPDATE public.random_match_queue AS queue_row
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE queue_row.user_id = actor_id;

  RETURN QUERY
  SELECT * FROM public.join_random_match_internal(actor_id, other_participant);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_random_action_rate_limit(TEXT, INTEGER, INTERVAL, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analyze_random_message_risk(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_random_session_view(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_random_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_random_user(UUID, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
