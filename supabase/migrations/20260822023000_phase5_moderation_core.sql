ALTER TABLE public.reports
DROP CONSTRAINT IF EXISTS reports_category_valid;

ALTER TABLE public.reports
ADD CONSTRAINT reports_category_valid CHECK (
  category IN (
    'suspected_male_impersonation',
    'identity_mismatch',
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
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT admin_users_role_valid CHECK (role IN ('reviewer', 'moderator', 'admin'))
);

CREATE TABLE IF NOT EXISTS public.moderation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  case_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL,
  source_id UUID,
  assigned_admin_id UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT moderation_cases_type_valid CHECK (
    case_type IN (
      'suspected_male_impersonation',
      'identity_mismatch',
      'stolen_photo',
      'impersonation',
      'scam',
      'harassment',
      'verification_review',
      'photo_review',
      'suspected_minor',
      'other'
    )
  ),
  CONSTRAINT moderation_cases_priority_valid CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT moderation_cases_status_valid CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  CONSTRAINT moderation_cases_source_valid CHECK (source IN ('report', 'verification', 'photo', 'risk_event', 'system'))
);

CREATE TABLE IF NOT EXISTS public.moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  admin_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT moderation_logs_action_valid CHECK (
    action IN (
      'case_opened',
      'case_assigned',
      'case_resolved',
      'case_dismissed',
      'warning_issued',
      'verification_approved',
      'verification_rejected',
      'photo_approved',
      'photo_rejected',
      'photo_under_review',
      'account_under_review',
      'account_suspended',
      'account_restored',
      'report_resolved',
      'report_dismissed',
      'verification_media_cleanup'
    )
  )
);

CREATE INDEX IF NOT EXISTS admin_users_role_active_idx
ON public.admin_users (role, active);

CREATE INDEX IF NOT EXISTS moderation_cases_subject_status_idx
ON public.moderation_cases (subject_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS moderation_cases_priority_status_idx
ON public.moderation_cases (priority, status, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_cases_source_idx
ON public.moderation_cases (source, source_id);

CREATE INDEX IF NOT EXISTS moderation_logs_case_created_idx
ON public.moderation_logs (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_logs_target_created_idx
ON public.moderation_logs (target_user_id, created_at DESC);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_admin(
  p_roles TEXT[] DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN TRUE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.admin_users AS admin_user
      WHERE admin_user.user_id = auth.uid()
        AND admin_user.active = TRUE
        AND (p_roles IS NULL OR admin_user.role = ANY(p_roles))
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.require_active_admin(
  p_roles TEXT[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_admin(p_roles) THEN
    RAISE EXCEPTION 'Admin authorization required.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_write_moderation_log(
  p_case_id UUID,
  p_admin_user_id UUID,
  p_target_user_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_log_id UUID;
BEGIN
  INSERT INTO public.moderation_logs (
    case_id,
    admin_user_id,
    target_user_id,
    action,
    reason,
    metadata
  )
  VALUES (
    p_case_id,
    p_admin_user_id,
    p_target_user_id,
    p_action,
    NULLIF(BTRIM(COALESCE(p_reason, '')), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_log_id;

  RETURN new_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_set_profile_account_status(
  p_target_user_id UUID,
  p_status TEXT
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF p_status NOT IN ('active', 'under_review', 'suspended') THEN
    RAISE EXCEPTION 'Unsupported account status.';
  END IF;

  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET account_status = p_status
  WHERE id = p_target_user_id
  RETURNING * INTO updated_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found.';
  END IF;

  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_open_or_update_case(
  p_subject_user_id UUID,
  p_case_type TEXT,
  p_priority TEXT,
  p_source TEXT,
  p_source_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.moderation_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  case_row public.moderation_cases%ROWTYPE;
BEGIN
  SELECT *
  INTO case_row
  FROM public.moderation_cases
  WHERE subject_user_id = p_subject_user_id
    AND case_type = p_case_type
    AND status IN ('pending', 'reviewing')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.moderation_cases
    SET priority = CASE
          WHEN p_priority = 'critical' THEN 'critical'
          WHEN p_priority = 'high' AND priority IN ('low', 'normal') THEN 'high'
          WHEN p_priority = 'normal' AND priority = 'low' THEN 'normal'
          ELSE priority
        END,
        updated_at = timezone('utc'::text, now()),
        source = COALESCE(source, p_source),
        source_id = COALESCE(source_id, p_source_id)
    WHERE id = case_row.id
    RETURNING * INTO case_row;

    RETURN case_row;
  END IF;

  INSERT INTO public.moderation_cases (
    subject_user_id,
    case_type,
    priority,
    status,
    source,
    source_id
  )
  VALUES (
    p_subject_user_id,
    p_case_type,
    p_priority,
    'pending',
    p_source,
    p_source_id
  )
  RETURNING * INTO case_row;

  PERFORM public.internal_write_moderation_log(
    case_row.id,
    NULL,
    p_subject_user_id,
    'case_opened',
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN case_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_sync_identity_case(
  p_subject_user_id UUID,
  p_source_report_id UUID DEFAULT NULL
)
RETURNS public.moderation_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  case_type_value TEXT := 'suspected_male_impersonation';
  priority_value TEXT := 'normal';
  distinct_reporter_count INTEGER := 0;
  block_count INTEGER := 0;
  repeated_device_count INTEGER := 0;
  trust_score_value INTEGER := 50;
  current_status TEXT := 'active';
  case_row public.moderation_cases%ROWTYPE;
  updated_profile public.profiles%ROWTYPE;
BEGIN
  SELECT COUNT(DISTINCT report.reporter_id)
  INTO distinct_reporter_count
  FROM public.reports AS report
  WHERE report.reported_user_id = p_subject_user_id
    AND report.category IN (
      'suspected_male_impersonation',
      'identity_mismatch',
      'stolen_photo',
      'impersonation'
    )
    AND report.status IN ('pending', 'reviewing', 'resolved');

  SELECT COUNT(*)
  INTO block_count
  FROM public.blocks
  WHERE blocked_user_id = p_subject_user_id;

  SELECT COUNT(*)
  INTO repeated_device_count
  FROM public.risk_events
  WHERE user_id = p_subject_user_id
    AND event_type = 'repeated_device_accounts';

  SELECT profile.trust_score, profile.account_status
  INTO trust_score_value, current_status
  FROM public.profiles AS profile
  WHERE profile.id = p_subject_user_id;

  IF EXISTS (
    SELECT 1
    FROM public.reports
    WHERE reported_user_id = p_subject_user_id
      AND category = 'suspected_male_impersonation'
  ) THEN
    case_type_value := 'suspected_male_impersonation';
  ELSIF EXISTS (
    SELECT 1
    FROM public.reports
    WHERE reported_user_id = p_subject_user_id
      AND category = 'identity_mismatch'
  ) THEN
    case_type_value := 'identity_mismatch';
  ELSIF EXISTS (
    SELECT 1
    FROM public.reports
    WHERE reported_user_id = p_subject_user_id
      AND category = 'stolen_photo'
  ) THEN
    case_type_value := 'stolen_photo';
  ELSIF EXISTS (
    SELECT 1
    FROM public.reports
    WHERE reported_user_id = p_subject_user_id
      AND category = 'impersonation'
  ) THEN
    case_type_value := 'impersonation';
  END IF;

  priority_value := CASE
    WHEN distinct_reporter_count >= 5 OR (distinct_reporter_count >= 3 AND repeated_device_count > 0) THEN 'critical'
    WHEN distinct_reporter_count >= 3 OR repeated_device_count > 0 OR block_count >= 3 OR trust_score_value <= 30 THEN 'high'
    WHEN distinct_reporter_count >= 1 THEN 'normal'
    ELSE 'low'
  END;

  case_row := public.internal_open_or_update_case(
    p_subject_user_id,
    case_type_value,
    priority_value,
    'report',
    p_source_report_id,
    NULL,
    jsonb_build_object(
      'distinct_reporter_count', distinct_reporter_count,
      'block_count', block_count,
      'repeated_device_count', repeated_device_count,
      'trust_score', trust_score_value
    )
  );

  IF priority_value IN ('high', 'critical') AND current_status = 'active' THEN
    updated_profile := public.internal_set_profile_account_status(p_subject_user_id, 'under_review');
    PERFORM public.internal_write_moderation_log(
      case_row.id,
      NULL,
      p_subject_user_id,
      'account_under_review',
      'Identity / community eligibility requires review.',
      jsonb_build_object(
        'trigger', 'identity_case_escalation',
        'account_status', updated_profile.account_status,
        'distinct_reporter_count', distinct_reporter_count
      )
    );
  END IF;

  RETURN case_row;
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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

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

  RETURN NEXT;
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

CREATE OR REPLACE FUNCTION public.review_moderation_case(
  p_case_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.moderation_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  case_row public.moderation_cases%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    PERFORM public.require_active_admin(ARRAY['reviewer', 'moderator', 'admin']);
  END IF;

  IF p_decision NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unsupported case decision.';
  END IF;

  UPDATE public.moderation_cases
  SET status = p_decision,
      updated_at = timezone('utc'::text, now()),
      resolved_at = timezone('utc'::text, now())
  WHERE id = p_case_id
  RETURNING * INTO case_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moderation case not found.';
  END IF;

  PERFORM public.internal_write_moderation_log(
    case_row.id,
    CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
    case_row.subject_user_id,
    CASE WHEN p_decision = 'resolved' THEN 'case_resolved' ELSE 'case_dismissed' END,
    p_reason,
    jsonb_build_object('status', case_row.status)
  );

  RETURN case_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.take_moderation_case(
  p_case_id UUID
)
RETURNS public.moderation_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  case_row public.moderation_cases%ROWTYPE;
BEGIN
  PERFORM public.require_active_admin(ARRAY['reviewer', 'moderator', 'admin']);

  UPDATE public.moderation_cases
  SET assigned_admin_id = actor_id,
      status = CASE WHEN status = 'pending' THEN 'reviewing' ELSE status END,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_case_id
    AND status IN ('pending', 'reviewing')
  RETURNING * INTO case_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moderation case not available.';
  END IF;

  PERFORM public.internal_write_moderation_log(
    case_row.id,
    actor_id,
    case_row.subject_user_id,
    'case_assigned',
    NULL,
    jsonb_build_object('assigned_admin_id', actor_id)
  );

  RETURN case_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_account(
  target_user_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  status_value TEXT;
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    PERFORM public.require_active_admin(ARRAY['moderator', 'admin']);
  END IF;

  status_value := CASE p_action
    WHEN 'under_review' THEN 'under_review'
    WHEN 'suspend' THEN 'suspended'
    WHEN 'restore' THEN 'active'
    ELSE NULL
  END;

  IF status_value IS NULL THEN
    RAISE EXCEPTION 'Unsupported moderation action.';
  END IF;

  updated_profile := public.internal_set_profile_account_status(target_user_id, status_value);

  PERFORM public.internal_write_moderation_log(
    NULL,
    CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
    target_user_id,
    CASE status_value
      WHEN 'under_review' THEN 'account_under_review'
      WHEN 'suspended' THEN 'account_suspended'
      ELSE 'account_restored'
    END,
    p_reason,
    jsonb_build_object('account_status', updated_profile.account_status)
  );

  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_verification(
  p_verification_id UUID,
  p_status TEXT,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  verification_id UUID,
  user_id UUID,
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  profile_verified BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  verification_row public.verifications%ROWTYPE;
  verified_value BOOLEAN;
  case_row public.moderation_cases%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    PERFORM public.require_active_admin(ARRAY['reviewer', 'moderator', 'admin']);
  END IF;

  IF p_status NOT IN ('verified', 'rejected', 'manual_review') THEN
    RAISE EXCEPTION 'Unsupported review status.';
  END IF;

  UPDATE public.verifications
  SET status = p_status,
      reviewed_at = timezone('utc'::text, now()),
      rejection_reason = CASE
        WHEN p_status = 'rejected' THEN NULLIF(BTRIM(COALESCE(p_rejection_reason, '')), '')
        ELSE NULL
      END,
      media_delete_after = CASE
        WHEN p_status IN ('verified', 'rejected') THEN timezone('utc'::text, now()) + interval '30 days'
        ELSE NULL
      END
  WHERE id = p_verification_id
  RETURNING * INTO verification_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found.';
  END IF;

  IF p_status = 'manual_review' THEN
    case_row := public.internal_open_or_update_case(
      verification_row.user_id,
      'verification_review',
      'high',
      'verification',
      verification_row.id,
      p_rejection_reason,
      jsonb_build_object('verification_id', verification_row.id)
    );
    verified_value := FALSE;
  ELSE
    verified_value := p_status = 'verified';
  END IF;

  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET verified = verified_value
  WHERE id = verification_row.user_id;

  PERFORM public.internal_write_moderation_log(
    case_row.id,
    CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
    verification_row.user_id,
    CASE
      WHEN p_status = 'verified' THEN 'verification_approved'
      WHEN p_status = 'rejected' THEN 'verification_rejected'
      ELSE 'case_opened'
    END,
    p_rejection_reason,
    jsonb_build_object(
      'verification_id', verification_row.id,
      'status', verification_row.status
    )
  );

  verification_id := verification_row.id;
  user_id := verification_row.user_id;
  status := verification_row.status;
  reviewed_at := verification_row.reviewed_at;
  profile_verified := verified_value;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_profile_photo(
  p_photo_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.profile_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  photo_row public.profile_photos%ROWTYPE;
  replacement_photo_id UUID;
  case_row public.moderation_cases%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    PERFORM public.require_active_admin(ARRAY['reviewer', 'moderator', 'admin']);
  END IF;

  IF p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Unsupported photo decision.';
  END IF;

  UPDATE public.profile_photos
  SET moderation_status = p_decision
  WHERE id = p_photo_id
  RETURNING * INTO photo_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile photo not found.';
  END IF;

  IF p_decision IN ('rejected', 'under_review') AND photo_row.is_primary THEN
    UPDATE public.profile_photos
    SET is_primary = FALSE
    WHERE id = photo_row.id;

    SELECT id
    INTO replacement_photo_id
    FROM public.profile_photos
    WHERE user_id = photo_row.user_id
      AND id <> photo_row.id
      AND moderation_status = 'approved'
    ORDER BY sort_order, created_at
    LIMIT 1;

    IF replacement_photo_id IS NOT NULL THEN
      UPDATE public.profile_photos
      SET is_primary = CASE WHEN id = replacement_photo_id THEN TRUE ELSE FALSE END
      WHERE user_id = photo_row.user_id
        AND moderation_status = 'approved';
    END IF;
  END IF;

  IF p_decision = 'under_review' THEN
    case_row := public.internal_open_or_update_case(
      photo_row.user_id,
      'photo_review',
      'normal',
      'photo',
      photo_row.id,
      p_reason,
      jsonb_build_object('photo_id', photo_row.id)
    );
  END IF;

  SELECT *
  INTO photo_row
  FROM public.profile_photos
  WHERE id = p_photo_id;

  PERFORM public.internal_write_moderation_log(
    case_row.id,
    CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
    photo_row.user_id,
    CASE
      WHEN p_decision = 'approved' THEN 'photo_approved'
      WHEN p_decision = 'rejected' THEN 'photo_rejected'
      ELSE 'photo_under_review'
    END,
    p_reason,
    jsonb_build_object(
      'photo_id', photo_row.id,
      'is_primary', photo_row.is_primary,
      'moderation_status', photo_row.moderation_status
    )
  );

  RETURN photo_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.flag_photo_under_review(
  p_photo_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.review_profile_photo(p_photo_id, 'under_review', p_reason);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_report(
  p_report_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  report_row public.reports%ROWTYPE;
  trust_before INTEGER;
  trust_after INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    PERFORM public.require_active_admin(ARRAY['reviewer', 'moderator', 'admin']);
  END IF;

  IF p_decision NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unsupported report decision.';
  END IF;

  SELECT profile.trust_score
  INTO trust_before
  FROM public.profiles AS profile
  JOIN public.reports AS report
    ON report.reported_user_id = profile.id
  WHERE report.id = p_report_id;

  UPDATE public.reports
  SET status = p_decision,
      reviewed_at = timezone('utc'::text, now())
  WHERE id = p_report_id
  RETURNING * INTO report_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found.';
  END IF;

  IF p_decision = 'resolved' THEN
    PERFORM public.apply_risk_event(
      report_row.reported_user_id,
      'valid_report_received',
      jsonb_build_object(
        'report_id', report_row.id,
        'category', report_row.category,
        'review_reason', NULLIF(BTRIM(COALESCE(p_reason, '')), '')
      )
    );

    IF report_row.category IN (
      'suspected_male_impersonation',
      'identity_mismatch',
      'stolen_photo',
      'impersonation'
    ) THEN
      PERFORM public.internal_sync_identity_case(report_row.reported_user_id, report_row.id);
    END IF;
  END IF;

  SELECT trust_score
  INTO trust_after
  FROM public.profiles
  WHERE id = report_row.reported_user_id;

  PERFORM public.internal_write_moderation_log(
    NULL,
    CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
    report_row.reported_user_id,
    CASE WHEN p_decision = 'resolved' THEN 'report_resolved' ELSE 'report_dismissed' END,
    p_reason,
    jsonb_build_object(
      'report_id', report_row.id,
      'category', report_row.category,
      'trust_before', trust_before,
      'trust_after', trust_after
    )
  );

  RETURN report_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_media(
  p_now TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_rows INTEGER := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('herlink.internal_cleanup_job', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Only trusted cleanup flows can clean verification media.';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'verification-private'
    AND name IN (
      SELECT media_path
      FROM public.verifications
      WHERE media_path IS NOT NULL
        AND status IN ('verified', 'rejected')
        AND media_delete_after IS NOT NULL
        AND media_delete_after <= p_now
    );

  UPDATE public.verifications
  SET media_path = NULL,
      metadata = metadata || jsonb_build_object('media_cleaned_at', p_now)
  WHERE media_path IS NOT NULL
    AND status IN ('verified', 'rejected')
    AND media_delete_after IS NOT NULL
    AND media_delete_after <= p_now;

  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_verification_media_cleanup_job()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_rows INTEGER := 0;
BEGIN
  PERFORM set_config('herlink.internal_cleanup_job', 'on', true);
  deleted_rows := public.cleanup_expired_verification_media(timezone('utc'::text, now()));

  PERFORM public.internal_write_moderation_log(
    NULL,
    NULL,
    NULL,
    'verification_media_cleanup',
    NULL,
    jsonb_build_object('deleted_rows', deleted_rows, 'success', TRUE)
  );

  RETURN deleted_rows;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM public.internal_write_moderation_log(
      NULL,
      NULL,
      NULL,
      'verification_media_cleanup',
      SQLERRM,
      jsonb_build_object('deleted_rows', 0, 'success', FALSE)
    );
    RAISE;
END;
$$;

GRANT SELECT ON public.admin_users TO authenticated, service_role;
GRANT SELECT ON public.moderation_cases TO authenticated, service_role;
GRANT SELECT ON public.moderation_logs TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_active_admin(TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_active_admin(TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_moderation_case(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.take_moderation_case(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.moderate_account(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_verification(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_profile_photo(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_report(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_verification_media_cleanup_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_verification_media(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_photo_under_review(UUID, TEXT) TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.admin_users FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.moderation_cases FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.moderation_logs FROM authenticated, anon;
REVOKE UPDATE ON public.verifications FROM authenticated;
REVOKE UPDATE ON public.profile_photos FROM authenticated;
REVOKE UPDATE ON public.reports FROM authenticated;

DROP POLICY IF EXISTS "Admins can see admin users" ON public.admin_users;
CREATE POLICY "Admins can see admin users"
ON public.admin_users
FOR SELECT
USING (auth.uid() = user_id OR public.is_active_admin(ARRAY['admin']));

DROP POLICY IF EXISTS "Active admins can read moderation cases" ON public.moderation_cases;
CREATE POLICY "Active admins can read moderation cases"
ON public.moderation_cases
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read moderation logs" ON public.moderation_logs;
CREATE POLICY "Active admins can read moderation logs"
ON public.moderation_logs
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all profiles" ON public.profiles;
CREATE POLICY "Active admins can read all profiles"
ON public.profiles
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all reports" ON public.reports;
CREATE POLICY "Active admins can read all reports"
ON public.reports
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all risk events" ON public.risk_events;
CREATE POLICY "Active admins can read all risk events"
ON public.risk_events
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all verifications" ON public.verifications;
CREATE POLICY "Active admins can read all verifications"
ON public.verifications
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all profile photos" ON public.profile_photos;
CREATE POLICY "Active admins can read all profile photos"
ON public.profile_photos
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Admins can read verification objects" ON storage.objects;
CREATE POLICY "Admins can read verification objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin'])
);

DROP POLICY IF EXISTS "Admins can read all profile photo objects" ON storage.objects;
CREATE POLICY "Admins can read all profile photo objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin'])
);

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'herlink_verification_media_cleanup_daily'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'herlink_verification_media_cleanup_daily',
    '15 3 * * *',
    $cron$SELECT public.run_verification_media_cleanup_job();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Unable to schedule HerLink verification cleanup job: %', SQLERRM;
END;
$$;
