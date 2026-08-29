ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS community_guidelines_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scope TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS rate_limit_events_scope_created_idx
ON public.rate_limit_events (user_id, scope, created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_hash TEXT,
  platform TEXT NOT NULL DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT push_tokens_unique_token UNIQUE (expo_push_token),
  CONSTRAINT push_tokens_platform_valid CHECK (platform IN ('android', 'ios', 'web', 'unknown'))
);

CREATE INDEX IF NOT EXISTS push_tokens_user_active_idx
ON public.push_tokens (user_id, active, updated_at DESC);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_events FROM public, anon;
REVOKE ALL ON public.push_tokens FROM public, anon;

GRANT SELECT ON public.push_tokens TO authenticated, service_role;
GRANT SELECT ON public.rate_limit_events TO service_role;

DROP POLICY IF EXISTS "Users can read their own push tokens" ON public.push_tokens;
CREATE POLICY "Users can read their own push tokens"
ON public.push_tokens
FOR SELECT
USING (auth.uid() = user_id);

ALTER TABLE public.risk_events
DROP CONSTRAINT IF EXISTS risk_events_event_type_valid;

ALTER TABLE public.risk_events
ADD CONSTRAINT risk_events_event_type_valid CHECK (
  event_type IN (
    'suspicious_money_message',
    'suspicious_investment_message',
    'suspicious_external_link',
    'repeated_message',
    'mass_messaging',
    'valid_report_received',
    'multiple_blocks_received',
    'credential_request',
    'repeated_device_accounts',
    'mass_like',
    'report_spam',
    'verification_submission_abuse'
  )
);

CREATE OR REPLACE FUNCTION public.apply_risk_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  event_id UUID,
  new_trust_score INTEGER,
  new_account_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  score_delta INTEGER;
BEGIN
  score_delta := CASE p_event_type
    WHEN 'valid_report_received' THEN -20
    WHEN 'multiple_blocks_received' THEN -10
    WHEN 'suspicious_money_message' THEN -25
    WHEN 'suspicious_investment_message' THEN -30
    WHEN 'suspicious_external_link' THEN -10
    WHEN 'repeated_message' THEN -10
    WHEN 'mass_messaging' THEN -20
    WHEN 'credential_request' THEN -30
    WHEN 'repeated_device_accounts' THEN -20
    WHEN 'mass_like' THEN -15
    WHEN 'report_spam' THEN -20
    WHEN 'verification_submission_abuse' THEN -15
    ELSE NULL
  END;

  IF score_delta IS NULL THEN
    RAISE EXCEPTION 'Unsupported risk event type.';
  END IF;

  INSERT INTO public.risk_events (user_id, event_type, risk_score_delta, metadata)
  VALUES (p_user_id, p_event_type, score_delta, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO event_id;

  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET trust_score = GREATEST(0, LEAST(100, trust_score + score_delta)),
      account_status = CASE
        WHEN account_status = 'active'
          AND GREATEST(0, LEAST(100, trust_score + score_delta)) < 20
          THEN 'under_review'
        ELSE account_status
      END
  WHERE id = p_user_id
  RETURNING trust_score, account_status
  INTO new_trust_score, new_account_status;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_rate_limit(
  p_scope TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  usage_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF COALESCE(p_limit, 0) <= 0 OR COALESCE(p_window_seconds, 0) <= 0 THEN
    RAISE EXCEPTION 'Rate limit configuration is invalid.';
  END IF;

  INSERT INTO public.rate_limit_events (user_id, scope, metadata)
  VALUES (actor_id, p_scope, COALESCE(p_metadata, '{}'::jsonb));

  SELECT COUNT(*)
  INTO usage_count
  FROM public.rate_limit_events
  WHERE user_id = actor_id
    AND scope = p_scope
    AND created_at >= timezone('utc'::text, now()) - make_interval(secs => p_window_seconds);

  IF usage_count > p_limit THEN
    RAISE EXCEPTION 'Too many attempts right now. Please try again later.';
  END IF;

  RETURN usage_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_or_update_push_token(
  p_expo_push_token TEXT,
  p_device_hash TEXT DEFAULT NULL,
  p_platform TEXT DEFAULT 'unknown'
)
RETURNS public.push_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  token_value TEXT := NULLIF(BTRIM(COALESCE(p_expo_push_token, '')), '');
  platform_value TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_platform), ''), 'unknown'));
  row_value public.push_tokens%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF token_value IS NULL OR LENGTH(token_value) < 16 THEN
    RAISE EXCEPTION 'Push token is invalid.';
  END IF;

  IF platform_value NOT IN ('android', 'ios', 'web', 'unknown') THEN
    platform_value := 'unknown';
  END IF;

  INSERT INTO public.push_tokens (
    user_id,
    expo_push_token,
    device_hash,
    platform,
    active,
    updated_at
  )
  VALUES (
    actor_id,
    token_value,
    NULLIF(BTRIM(COALESCE(p_device_hash, '')), ''),
    platform_value,
    TRUE,
    timezone('utc'::text, now())
  )
  ON CONFLICT (expo_push_token)
  DO UPDATE
  SET user_id = EXCLUDED.user_id,
      device_hash = EXCLUDED.device_hash,
      platform = EXCLUDED.platform,
      active = TRUE,
      updated_at = timezone('utc'::text, now())
  RETURNING * INTO row_value;

  RETURN row_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_push_token(
  p_expo_push_token TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.push_tokens
  SET active = FALSE,
      updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND active = TRUE
    AND (
      p_expo_push_token IS NULL
      OR expo_push_token = NULLIF(BTRIM(COALESCE(p_expo_push_token, '')), '')
    );

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  profile_row public.profiles%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET account_status = 'deletion_pending',
      deletion_requested_at = timezone('utc'::text, now())
  WHERE id = actor_id
  RETURNING * INTO profile_row;

  UPDATE public.push_tokens
  SET active = FALSE,
      updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND active = TRUE;

  UPDATE public.matches
  SET status = 'unmatched'
  WHERE status = 'active'
    AND (user_1_id = actor_id OR user_2_id = actor_id);

  RETURN profile_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_user(
  target_user_id UUID,
  p_category TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
  report_id UUID,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  report_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'report_user',
    8,
    3600,
    jsonb_build_object('target_user_id', target_user_id, 'category', p_category)
  );

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot report yourself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user was not found.';
  END IF;

  INSERT INTO public.reports (reporter_id, reported_user_id, category, description, status)
  VALUES (
    actor_id,
    target_user_id,
    p_category,
    NULLIF(BTRIM(COALESCE(p_description, '')), ''),
    'pending'
  )
  RETURNING id, reports.status, reports.created_at
  INTO report_id, status, created_at;

  SELECT COUNT(*)
  INTO report_count
  FROM public.reports
  WHERE reporter_id = actor_id
    AND created_at >= timezone('utc'::text, now()) - interval '1 hour';

  IF report_count >= 6 THEN
    PERFORM public.apply_risk_event(
      actor_id,
      'report_spam',
      jsonb_build_object('hourly_report_count', report_count)
    );
  END IF;

  IF p_category IN (
    'suspected_male_impersonation',
    'identity_mismatch',
    'stolen_photo',
    'impersonation'
  ) THEN
    PERFORM public.internal_sync_identity_case(target_user_id, report_id);
  END IF;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_verification_submission(
  p_method TEXT,
  p_file_extension TEXT DEFAULT 'jpg'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  method TEXT,
  media_path TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  file_extension TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_file_extension), ''), 'jpg'));
  submission_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'create_verification_submission',
    3,
    3600,
    jsonb_build_object('method', p_method)
  );

  IF p_method NOT IN ('liveness_manual', 'selfie_manual') THEN
    RAISE EXCEPTION 'Unsupported verification method.';
  END IF;

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible to submit verification.';
  END IF;

  id := gen_random_uuid();
  user_id := actor_id;
  status := 'pending';
  method := p_method;
  media_path := actor_id::text || '/' || id::text || '/verification.' || file_extension;
  submitted_at := timezone('utc'::text, now());

  INSERT INTO public.verifications (
    id,
    user_id,
    status,
    method,
    media_path,
    submitted_at,
    created_at
  )
  VALUES (
    id,
    user_id,
    status,
    method,
    media_path,
    submitted_at,
    timezone('utc'::text, now())
  )
  RETURNING verifications.created_at INTO created_at;

  SELECT COUNT(*)
  INTO submission_count
  FROM public.verifications
  WHERE user_id = actor_id
    AND created_at >= timezone('utc'::text, now()) - interval '1 day';

  IF submission_count >= 3 THEN
    PERFORM public.apply_risk_event(
      actor_id,
      'verification_submission_abuse',
      jsonb_build_object('daily_submission_count', submission_count)
    );
  END IF;

  RETURN NEXT;
END;
$$;

DROP FUNCTION IF EXISTS public.register_device(TEXT);

CREATE FUNCTION public.register_device(p_device_hash TEXT)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  device_hash TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  risk_signal_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  linked_user_count INTEGER := 0;
  existing_risk BOOLEAN := FALSE;
  row_id UUID;
  row_user_id UUID;
  row_device_hash TEXT;
  row_first_seen_at TIMESTAMPTZ;
  row_last_seen_at TIMESTAMPTZ;
  row_created_at TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'register_device',
    20,
    3600,
    jsonb_build_object('device_hash_prefix', LEFT(COALESCE(p_device_hash, ''), 8))
  );

  IF length(btrim(COALESCE(p_device_hash, ''))) < 16 THEN
    RAISE EXCEPTION 'Device hash is invalid.';
  END IF;

  INSERT INTO public.devices (user_id, device_hash)
  VALUES (actor_id, btrim(p_device_hash))
  ON CONFLICT (user_id, device_hash)
  DO UPDATE SET last_seen_at = timezone('utc'::text, now())
  RETURNING
    devices.id,
    devices.user_id,
    devices.device_hash,
    devices.first_seen_at,
    devices.last_seen_at,
    devices.created_at
  INTO row_id, row_user_id, row_device_hash, row_first_seen_at, row_last_seen_at, row_created_at;

  SELECT COUNT(DISTINCT devices.user_id)
  INTO linked_user_count
  FROM public.devices
  WHERE devices.device_hash = btrim(p_device_hash);

  risk_signal_created := FALSE;

  IF linked_user_count >= 2 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.risk_events
      WHERE risk_events.user_id = actor_id
        AND risk_events.event_type = 'repeated_device_accounts'
        AND risk_events.metadata ->> 'device_hash' = btrim(p_device_hash)
    )
    INTO existing_risk;

    IF NOT existing_risk THEN
      PERFORM public.apply_risk_event(
        actor_id,
        'repeated_device_accounts',
        jsonb_build_object(
          'device_hash', btrim(p_device_hash),
          'linked_account_count', linked_user_count
        )
      );
      risk_signal_created := TRUE;
    END IF;
  END IF;

  id := row_id;
  user_id := row_user_id;
  device_hash := row_device_hash;
  first_seen_at := row_first_seen_at;
  last_seen_at := row_last_seen_at;
  created_at := row_created_at;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(target_user_id UUID)
RETURNS TABLE (
  blocked BOOLEAN,
  active_match_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  created_block_id UUID;
  block_count INTEGER := 0;
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'block_user',
    20,
    3600,
    jsonb_build_object('target_user_id', target_user_id)
  );

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot block yourself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user was not found.';
  END IF;

  INSERT INTO public.blocks (blocker_id, blocked_user_id)
  VALUES (actor_id, target_user_id)
  ON CONFLICT (blocker_id, blocked_user_id) DO NOTHING
  RETURNING id INTO created_block_id;

  DELETE FROM public.likes
  WHERE (from_user_id = actor_id AND to_user_id = target_user_id)
     OR (from_user_id = target_user_id AND to_user_id = actor_id);

  UPDATE public.matches
  SET status = 'blocked'
  WHERE status = 'active'
    AND (user_1_id = LEAST(actor_id, target_user_id) AND user_2_id = GREATEST(actor_id, target_user_id));

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  UPDATE public.push_tokens
  SET active = FALSE,
      updated_at = timezone('utc'::text, now())
  WHERE user_id = target_user_id
    AND active = TRUE
    AND updated_rows > 0;

  SELECT COUNT(*)
  INTO block_count
  FROM public.blocks
  WHERE blocked_user_id = target_user_id;

  IF block_count = 2 THEN
    PERFORM public.apply_risk_event(
      target_user_id,
      'multiple_blocks_received',
      jsonb_build_object('block_count', block_count, 'triggered_by', actor_id)
    );
  END IF;

  RETURN QUERY SELECT TRUE, updated_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.like_user(target_user_id UUID)
RETURNS TABLE (liked BOOLEAN, matched BOOLEAN, match_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  canonical_user_1 UUID;
  canonical_user_2 UUID;
  existing_match RECORD;
  reverse_like_exists BOOLEAN := FALSE;
  like_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'like_user',
    120,
    3600,
    jsonb_build_object('target_user_id', target_user_id)
  );

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot like yourself.';
  END IF;

  IF public.has_block_between(actor_id, target_user_id) THEN
    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible to like right now.';
  END IF;

  IF NOT public.is_profile_eligible(target_user_id) THEN
    RAISE EXCEPTION 'Target user is not available.';
  END IF;

  canonical_user_1 := LEAST(actor_id, target_user_id);
  canonical_user_2 := GREATEST(actor_id, target_user_id);

  PERFORM pg_advisory_xact_lock(hashtextextended(canonical_user_1::text || ':' || canonical_user_2::text, 0));

  SELECT id, status
  INTO existing_match
  FROM public.matches
  WHERE user_1_id = canonical_user_1
    AND user_2_id = canonical_user_2;

  IF FOUND THEN
    IF existing_match.status = 'active' THEN
      RETURN QUERY SELECT TRUE, TRUE, existing_match.id;
      RETURN;
    END IF;

    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  INSERT INTO public.likes (from_user_id, to_user_id)
  VALUES (actor_id, target_user_id)
  ON CONFLICT (from_user_id, to_user_id) DO NOTHING;

  SELECT COUNT(*)
  INTO like_count
  FROM public.likes
  WHERE from_user_id = actor_id
    AND created_at >= timezone('utc'::text, now()) - interval '1 hour';

  IF like_count >= 80 THEN
    PERFORM public.apply_risk_event(
      actor_id,
      'mass_like',
      jsonb_build_object('hourly_like_count', like_count)
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE from_user_id = target_user_id
      AND to_user_id = actor_id
  )
  INTO reverse_like_exists;

  IF reverse_like_exists THEN
    INSERT INTO public.matches (user_1_id, user_2_id, status, matched_at)
    VALUES (canonical_user_1, canonical_user_2, 'active', timezone('utc'::text, now()))
    ON CONFLICT (user_1_id, user_2_id) DO NOTHING
    RETURNING id INTO match_id;

    IF match_id IS NULL THEN
      SELECT id, status
      INTO existing_match
      FROM public.matches
      WHERE user_1_id = canonical_user_1
        AND user_2_id = canonical_user_2;

      IF existing_match.status = 'active' THEN
        match_id := existing_match.id;
      ELSE
        RAISE EXCEPTION 'This connection is no longer available.';
      END IF;
    END IF;

    RETURN QUERY SELECT TRUE, TRUE, match_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, FALSE, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  p_match_id UUID,
  p_content TEXT
)
RETURNS TABLE (
  id UUID,
  match_id UUID,
  sender_id UUID,
  type TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  safety_warning TEXT,
  risk_level TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  other_user_id UUID;
  match_row public.matches%ROWTYPE;
  inserted_row public.messages%ROWTYPE;
  message_text TEXT := BTRIM(COALESCE(p_content, ''));
  request_signal BOOLEAN;
  external_signal BOOLEAN;
  investment_signal BOOLEAN;
  investment_high_signal BOOLEAN;
  money_signal BOOLEAN;
  credential_signal BOOLEAN;
  repeated_signal BOOLEAN := FALSE;
  mass_signal BOOLEAN := FALSE;
  detected_event_type TEXT := NULL;
  detected_warning TEXT := NULL;
  detected_risk_level TEXT := 'low';
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'send_message',
    30,
    60,
    jsonb_build_object('match_id', p_match_id)
  );

  IF message_text = '' THEN
    RAISE EXCEPTION 'Message content cannot be empty.';
  END IF;

  SELECT *
  INTO match_row
  FROM public.matches
  WHERE public.matches.id = p_match_id
    AND public.matches.status = 'active'
    AND (public.matches.user_1_id = actor_id OR public.matches.user_2_id = actor_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  other_user_id := CASE
    WHEN match_row.user_1_id = actor_id THEN match_row.user_2_id
    ELSE match_row.user_1_id
  END;

  IF public.has_block_between(actor_id, other_user_id) THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  IF NOT public.is_profile_eligible(actor_id) OR NOT public.is_profile_eligible(other_user_id) THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  request_signal := lower(message_text) ~ '(給我|傳給我|提供|借我|幫我|加我|聯絡我|私訊我|發我|告訴我)';
  external_signal := lower(message_text) ~ '(https?://|www\\.|t\\.me/|telegram|line群|line group|line)';
  investment_signal := lower(message_text) ~ '(投資|虛擬貨幣|usdt|交易所|帶你操作|穩賺)';
  investment_high_signal := lower(message_text) ~ '(保證獲利|帶你操作|穩賺)' OR (
    lower(message_text) ~ '(投資|usdt|虛擬貨幣|交易所)'
    AND lower(message_text) ~ '(保證獲利|帶你操作|穩賺|獲利)'
  );
  money_signal := lower(message_text) ~ '(匯款|轉帳|借錢|銀行帳號|atm|代付|儲值)';
  credential_signal := lower(message_text) ~ '(otp|驗證碼|密碼)';

  SELECT EXISTS (
    SELECT 1
    FROM public.messages AS existing_message
    WHERE existing_message.match_id = p_match_id
      AND existing_message.sender_id = actor_id
      AND lower(existing_message.content) = lower(message_text)
      AND existing_message.created_at >= timezone('utc'::text, now()) - interval '1 day'
  )
  INTO repeated_signal;

  SELECT COUNT(DISTINCT existing_message.match_id) >= 3
  INTO mass_signal
  FROM public.messages AS existing_message
  WHERE existing_message.sender_id = actor_id
    AND lower(existing_message.content) = lower(message_text)
    AND existing_message.created_at >= timezone('utc'::text, now()) - interval '1 day';

  IF investment_signal AND investment_high_signal THEN
    detected_risk_level := 'high';
    detected_warning := '這則訊息包含高風險投資話術，請提高警覺。';
    detected_event_type := 'suspicious_investment_message';
  ELSIF credential_signal AND request_signal THEN
    detected_risk_level := 'high';
    detected_warning := '這則訊息要求敏感驗證資訊，請不要提供。';
    detected_event_type := 'credential_request';
  ELSIF money_signal AND request_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息包含金錢往來請求，請提高警覺。';
    detected_event_type := 'suspicious_money_message';
  ELSIF external_signal AND request_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息引導到外部平台，請先確認對方身分。';
    detected_event_type := 'suspicious_external_link';
  ELSIF repeated_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息與近期內容高度重複，系統已記錄安全事件。';
    detected_event_type := 'repeated_message';
  ELSIF mass_signal THEN
    detected_risk_level := 'medium';
    detected_warning := '這則訊息短時間內被大量重複發送，系統已記錄安全事件。';
    detected_event_type := 'mass_messaging';
  END IF;

  INSERT INTO public.messages (match_id, sender_id, type, content)
  VALUES (p_match_id, actor_id, 'text', message_text)
  RETURNING * INTO inserted_row;

  IF detected_event_type IS NOT NULL THEN
    PERFORM public.apply_risk_event(
      actor_id,
      detected_event_type,
      jsonb_build_object(
        'match_id', p_match_id,
        'target_user_id', other_user_id,
        'content_preview', LEFT(message_text, 120),
        'risk_level', detected_risk_level
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    inserted_row.id,
    inserted_row.match_id,
    inserted_row.sender_id,
    inserted_row.type,
    inserted_row.content,
    inserted_row.created_at,
    inserted_row.read_at,
    detected_warning,
    detected_risk_level;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_rate_limit(TEXT, INTEGER, INTEGER, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_update_push_token(TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disable_push_token(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated, service_role;
