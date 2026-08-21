CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_user_id),
  CONSTRAINT blocks_unique_pair UNIQUE (blocker_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocker_id_idx ON public.blocks (blocker_id);
CREATE INDEX IF NOT EXISTS blocks_blocked_user_id_idx ON public.blocks (blocked_user_id);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT reports_no_self_report CHECK (reporter_id <> reported_user_id),
  CONSTRAINT reports_category_valid CHECK (
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
      'other'
    )
  ),
  CONSTRAINT reports_status_valid CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS reports_reporter_id_idx ON public.reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_reported_user_id_idx ON public.reports (reported_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status);

CREATE TABLE IF NOT EXISTS public.risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  risk_score_delta INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT risk_events_event_type_valid CHECK (
    event_type IN (
      'suspicious_money_message',
      'suspicious_investment_message',
      'suspicious_external_link',
      'repeated_message',
      'mass_messaging',
      'valid_report_received',
      'multiple_blocks_received',
      'credential_request'
    )
  )
);

CREATE INDEX IF NOT EXISTS risk_events_user_id_idx ON public.risk_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_events_event_type_idx ON public.risk_events (event_type);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_profile_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF current_setting('herlink.internal_profile_update', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'authenticated' OR auth.role() = 'anon' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := FALSE;
      NEW.trust_score := 50;
      NEW.account_status := 'active';
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.verified IS DISTINCT FROM OLD.verified
         OR NEW.trust_score IS DISTINCT FROM OLD.trust_score
         OR NEW.account_status IS DISTINCT FROM OLD.account_status THEN
        RAISE EXCEPTION 'You are not allowed to modify verified, trust_score, or account_status.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_block_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.blocks
    WHERE (blocker_id = user_a AND blocked_user_id = user_b)
       OR (blocker_id = user_b AND blocked_user_id = user_a)
  );
$$;

CREATE OR REPLACE FUNCTION public.list_discover_profiles()
RETURNS SETOF public.public_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.*
  FROM public.public_profiles AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id <> auth.uid()
    AND NOT public.has_block_between(auth.uid(), profile.id)
  ORDER BY profile.display_name NULLS LAST, profile.id;
$$;

CREATE OR REPLACE FUNCTION public.get_visible_public_profiles(p_user_ids UUID[])
RETURNS SETOF public.public_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.*
  FROM public.public_profiles AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND profile.id <> auth.uid()
    AND NOT public.has_block_between(auth.uid(), profile.id);
$$;

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
        WHEN GREATEST(0, LEAST(100, trust_score + score_delta)) < 20
             AND account_status = 'active' THEN 'under_review'
        ELSE account_status
      END
  WHERE id = p_user_id
  RETURNING trust_score, account_status
  INTO new_trust_score, new_account_status;

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
    AND (
      (user_1_id = LEAST(actor_id, target_user_id) AND user_2_id = GREATEST(actor_id, target_user_id))
    );

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

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

  RETURN NEXT;
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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

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
  event_type TEXT := NULL;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF message_text = '' THEN
    RAISE EXCEPTION 'Message content cannot be empty.';
  END IF;

  SELECT *
  INTO match_row
  FROM public.matches
  WHERE public.matches.id = p_match_id
    AND status = 'active'
    AND (user_1_id = actor_id OR user_2_id = actor_id);

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
    FROM public.messages
    WHERE match_id = p_match_id
      AND sender_id = actor_id
      AND lower(content) = lower(message_text)
      AND created_at >= timezone('utc'::text, now()) - interval '1 day'
  )
  INTO repeated_signal;

  SELECT COUNT(DISTINCT match_id) >= 3
  INTO mass_signal
  FROM public.messages
  WHERE sender_id = actor_id
    AND lower(content) = lower(message_text)
    AND created_at >= timezone('utc'::text, now()) - interval '1 day';

  risk_level := 'low';
  safety_warning := NULL;

  IF investment_signal AND investment_high_signal THEN
    risk_level := 'high';
    safety_warning := '這則訊息包含高風險投資話術，請提高警覺。';
    event_type := 'suspicious_investment_message';
  ELSIF credential_signal AND request_signal THEN
    risk_level := 'high';
    safety_warning := '這則訊息要求敏感驗證資訊，請不要提供。';
    event_type := 'credential_request';
  ELSIF money_signal AND request_signal THEN
    risk_level := 'medium';
    safety_warning := '這則訊息包含金錢往來請求，請提高警覺。';
    event_type := 'suspicious_money_message';
  ELSIF external_signal AND request_signal THEN
    risk_level := 'medium';
    safety_warning := '這則訊息引導到外部平台，請先確認對方身分。';
    event_type := 'suspicious_external_link';
  ELSIF repeated_signal THEN
    risk_level := 'medium';
    safety_warning := '這則訊息與近期內容高度重複，系統已記錄安全事件。';
    event_type := 'repeated_message';
  ELSIF mass_signal THEN
    risk_level := 'medium';
    safety_warning := '這則訊息短時間內被大量重複發送，系統已記錄安全事件。';
    event_type := 'mass_messaging';
  END IF;

  INSERT INTO public.messages (match_id, sender_id, type, content)
  VALUES (p_match_id, actor_id, 'text', message_text)
  RETURNING * INTO inserted_row;

  IF event_type IS NOT NULL THEN
    PERFORM public.apply_risk_event(
      actor_id,
      event_type,
      jsonb_build_object(
        'match_id', p_match_id,
        'target_user_id', other_user_id,
        'content_preview', LEFT(message_text, 120),
        'risk_level', risk_level
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
    safety_warning,
    risk_level;
END;
$$;

REVOKE ALL ON public.blocks FROM public, anon;
REVOKE ALL ON public.reports FROM public, anon;
REVOKE ALL ON public.risk_events FROM public, anon;

GRANT SELECT ON public.blocks TO authenticated, service_role;
GRANT SELECT ON public.reports TO authenticated, service_role;
GRANT SELECT ON public.messages TO authenticated, service_role;
GRANT INSERT ON public.messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_events TO service_role;

REVOKE INSERT ON public.messages FROM authenticated;

GRANT EXECUTE ON FUNCTION public.has_block_between(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_discover_profiles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_visible_public_profiles(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_user(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_risk_event(UUID, TEXT, JSONB) TO service_role;

DROP POLICY IF EXISTS "Users can see their own blocks" ON public.blocks;
CREATE POLICY "Users can see their own blocks"
ON public.blocks
FOR SELECT
USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can see their own reports" ON public.reports;
CREATE POLICY "Users can see their own reports"
ON public.reports
FOR SELECT
USING (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can read active match messages" ON public.messages;
CREATE POLICY "Users can read active match messages"
ON public.messages
FOR SELECT
USING (public.is_match_member(match_id, auth.uid(), 'active'));

DROP POLICY IF EXISTS "Users can send messages to active matches" ON public.messages;
