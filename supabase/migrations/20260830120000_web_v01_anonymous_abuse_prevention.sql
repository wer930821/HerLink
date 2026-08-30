CREATE OR REPLACE FUNCTION public.anonymous_installation_key(p_installation_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_installation_id, '')) = '' THEN NULL
    ELSE md5(lower(btrim(p_installation_id)))
  END;
$$;

CREATE TABLE IF NOT EXISTS public.anonymous_risk_identities (
  installation_key TEXT PRIMARY KEY,
  first_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  current_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_account_rotation_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  temporary_suspension_until TIMESTAMPTZ,
  review_required BOOLEAN NOT NULL DEFAULT FALSE,
  last_risk_score INTEGER NOT NULL DEFAULT 0,
  last_decision TEXT NOT NULL DEFAULT 'allow',
  last_reason_code TEXT,
  last_evaluated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS anonymous_risk_identities_current_user_id_idx
  ON public.anonymous_risk_identities (current_user_id);

ALTER TABLE public.anonymous_risk_identities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.anonymous_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_key TEXT NOT NULL REFERENCES public.anonymous_risk_identities(installation_key) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT anonymous_risk_events_type_valid CHECK (
    event_type IN (
      'anonymous_signup',
      'anonymous_account_rotation',
      'queue_join',
      'queue_leave',
      'next_match',
      'session_leave',
      'report_received',
      'block_received',
      'fraud_low',
      'fraud_medium',
      'fraud_high',
      'fraud_critical'
    )
  )
);

CREATE INDEX IF NOT EXISTS anonymous_risk_events_installation_created_idx
  ON public.anonymous_risk_events (installation_key, created_at DESC);

CREATE INDEX IF NOT EXISTS anonymous_risk_events_user_created_idx
  ON public.anonymous_risk_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS anonymous_risk_events_type_created_idx
  ON public.anonymous_risk_events (event_type, created_at DESC);

ALTER TABLE public.anonymous_risk_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.anonymous_risk_identities TO service_role;
GRANT SELECT ON public.anonymous_risk_events TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_anonymous_abuse_status_by_key(p_installation_key TEXT)
RETURNS TABLE (
  installation_key TEXT,
  current_user_id UUID,
  risk_score INTEGER,
  decision TEXT,
  reason_code TEXT,
  cooldown_until TIMESTAMPTZ,
  temporary_suspension_until TIMESTAMPTZ,
  review_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
  actor_id UUID;
  actor_profile_status TEXT;
  existing_row RECORD;
  rotation_count INTEGER := 0;
  queue_join_count INTEGER := 0;
  queue_leave_count INTEGER := 0;
  next_match_count INTEGER := 0;
  session_leave_count INTEGER := 0;
  report_received_count INTEGER := 0;
  block_received_count INTEGER := 0;
  fraud_low_count INTEGER := 0;
  fraud_medium_count INTEGER := 0;
  fraud_high_count INTEGER := 0;
  fraud_critical_count INTEGER := 0;
  computed_score INTEGER := 0;
  next_decision TEXT := 'allow';
  next_reason_code TEXT := NULL;
  next_cooldown_until TIMESTAMPTZ := NULL;
  next_temporary_until TIMESTAMPTZ := NULL;
  next_review_required BOOLEAN := FALSE;
BEGIN
  IF btrim(COALESCE(p_installation_key, '')) = '' THEN
    RETURN QUERY
    SELECT
      NULL::TEXT,
      NULL::UUID,
      0::INTEGER,
      'blocked'::TEXT,
      'identity_required'::TEXT,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ,
      FALSE::BOOLEAN;
    RETURN;
  END IF;

  SELECT *
  INTO existing_row
  FROM public.anonymous_risk_identities AS identity_row
  WHERE identity_row.installation_key = p_installation_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p_installation_key,
      NULL::UUID,
      0::INTEGER,
      'blocked'::TEXT,
      'identity_required'::TEXT,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ,
      FALSE::BOOLEAN;
    RETURN;
  END IF;

  actor_id := existing_row.current_user_id;

  IF actor_id IS NOT NULL THEN
    PERFORM public.reconcile_profile_enforcement_status(actor_id);

    SELECT profile.account_status
    INTO actor_profile_status
    FROM public.profiles AS profile
    WHERE profile.id = actor_id
    LIMIT 1;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN event_type = 'anonymous_account_rotation' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'queue_join' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'queue_leave' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'next_match' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'session_leave' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'report_received' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'block_received' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_low' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_medium' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_high' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_critical' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)
  INTO
    rotation_count,
    queue_join_count,
    queue_leave_count,
    next_match_count,
    session_leave_count,
    report_received_count,
    block_received_count,
    fraud_low_count,
    fraud_medium_count,
    fraud_high_count,
    fraud_critical_count
  FROM public.anonymous_risk_events
  WHERE anonymous_risk_events.installation_key = p_installation_key;

  computed_score :=
    (rotation_count * 4)
    + (GREATEST(queue_join_count - 3, 0))
    + (GREATEST(queue_leave_count + session_leave_count - 4, 0))
    + (GREATEST(next_match_count - 2, 0) * 2)
    + (report_received_count * 2)
    + (block_received_count * 2)
    + (fraud_low_count)
    + (fraud_medium_count * 2)
    + (fraud_high_count * 4)
    + (fraud_critical_count * 6);

  IF actor_profile_status IS DISTINCT FROM 'active' THEN
    next_decision := 'blocked';
    next_reason_code := 'account_restricted';
  ELSIF existing_row.temporary_suspension_until IS NOT NULL
    AND existing_row.temporary_suspension_until > timezone('utc'::text, now()) THEN
    next_decision := 'temporary_suspension';
    next_reason_code := 'temporary_suspension_active';
    next_temporary_until := existing_row.temporary_suspension_until;
    next_review_required := TRUE;
  ELSIF existing_row.cooldown_until IS NOT NULL
    AND existing_row.cooldown_until > timezone('utc'::text, now()) THEN
    next_decision := 'cooldown';
    next_reason_code := 'cooldown_active';
    next_cooldown_until := existing_row.cooldown_until;
  ELSIF computed_score >= 10
    OR rotation_count >= 3
    OR report_received_count >= 5
    OR block_received_count >= 3
    OR fraud_critical_count >= 1 THEN
    next_decision := 'temporary_suspension';
    next_reason_code := 'anonymous_abuse_high_risk';
    next_temporary_until := timezone('utc'::text, now()) + INTERVAL '24 hours';
    next_review_required := TRUE;
  ELSIF computed_score >= 5
    OR rotation_count >= 2
    OR report_received_count >= 3
    OR block_received_count >= 2
    OR fraud_high_count >= 2
    OR (queue_join_count >= 6 AND next_match_count >= 2) THEN
    next_decision := 'cooldown';
    next_reason_code := 'anonymous_abuse_cooldown';
    next_cooldown_until := timezone('utc'::text, now()) + INTERVAL '15 minutes';
  ELSE
    next_decision := 'allow';
    next_reason_code := NULL;
  END IF;

  UPDATE public.anonymous_risk_identities
  SET
    last_seen_at = timezone('utc'::text, now()),
    last_evaluated_at = timezone('utc'::text, now()),
    last_risk_score = computed_score,
    last_decision = next_decision,
    last_reason_code = next_reason_code,
    review_required = next_review_required,
    cooldown_until = CASE
      WHEN next_decision = 'cooldown' THEN next_cooldown_until
      WHEN next_decision = 'allow' THEN NULL
      ELSE cooldown_until
    END,
    temporary_suspension_until = CASE
      WHEN next_decision = 'temporary_suspension' THEN next_temporary_until
      WHEN next_decision = 'allow' THEN NULL
      ELSE temporary_suspension_until
    END
  WHERE anonymous_risk_identities.installation_key = p_installation_key;

  IF next_decision <> 'allow' AND actor_id IS NOT NULL THEN
    UPDATE public.random_match_queue
    SET status = 'left',
        updated_at = timezone('utc'::text, now()),
        matched_session_id = NULL
    WHERE user_id = actor_id
      AND status = 'waiting';
  END IF;

  RETURN QUERY
  SELECT
    p_installation_key,
    actor_id,
    computed_score,
    next_decision,
    next_reason_code,
    CASE
      WHEN next_decision = 'cooldown' THEN next_cooldown_until
      WHEN next_decision = 'allow' THEN NULL
      ELSE existing_row.cooldown_until
    END,
    CASE
      WHEN next_decision = 'temporary_suspension' THEN next_temporary_until
      WHEN next_decision = 'allow' THEN NULL
      ELSE existing_row.temporary_suspension_until
    END,
    next_review_required;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_anonymous_risk_event_by_user_id(
  p_user_id UUID,
  p_event_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_session_id UUID DEFAULT NULL,
  p_report_id UUID DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
  v_installation_key TEXT;
BEGIN
  IF p_user_id IS NULL OR btrim(COALESCE(p_event_type, '')) = '' THEN
    RETURN;
  END IF;

  SELECT identity_row.installation_key
  INTO v_installation_key
  FROM public.anonymous_risk_identities AS identity_row
  WHERE identity_row.current_user_id = p_user_id
  LIMIT 1;

  IF v_installation_key IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.anonymous_risk_events (
    installation_key,
    user_id,
    event_type,
    session_id,
    report_id,
    target_user_id,
    metadata,
    created_at
  )
  VALUES (
    v_installation_key,
    p_user_id,
    p_event_type,
    p_session_id,
    p_report_id,
    p_target_user_id,
    COALESCE(p_metadata, '{}'::jsonb),
    timezone('utc'::text, now())
  );

  PERFORM public.refresh_anonymous_abuse_status_by_key(v_installation_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_anonymous_abuse_identity(p_installation_id TEXT)
RETURNS TABLE (
  installation_key TEXT,
  current_user_id UUID,
  risk_score INTEGER,
  decision TEXT,
  reason_code TEXT,
  cooldown_until TIMESTAMPTZ,
  temporary_suspension_until TIMESTAMPTZ,
  review_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
  actor_id UUID := auth.uid();
  normalized_installation_key TEXT := public.anonymous_installation_key(p_installation_id);
  existing_row RECORD;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF normalized_installation_key IS NULL THEN
    RAISE EXCEPTION 'Anonymous installation id is required.';
  END IF;

  SELECT *
  INTO existing_row
  FROM public.anonymous_risk_identities AS identity_row
  WHERE identity_row.installation_key = normalized_installation_key
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.anonymous_risk_identities
    SET
      current_user_id = actor_id,
      first_user_id = COALESCE(first_user_id, actor_id),
      last_seen_at = timezone('utc'::text, now()),
      last_account_rotation_at = CASE
        WHEN current_user_id IS DISTINCT FROM actor_id THEN timezone('utc'::text, now())
        ELSE last_account_rotation_at
      END
    WHERE anonymous_risk_identities.installation_key = normalized_installation_key;

    IF existing_row.current_user_id IS DISTINCT FROM actor_id THEN
      PERFORM public.record_anonymous_risk_event_by_user_id(
        actor_id,
        'anonymous_account_rotation',
        jsonb_build_object('installation_key', normalized_installation_key)
      );
    END IF;
  ELSE
    INSERT INTO public.anonymous_risk_identities (
      installation_key,
      first_user_id,
      current_user_id,
      first_seen_at,
      last_seen_at
    )
    VALUES (
      normalized_installation_key,
      actor_id,
      actor_id,
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    );

    PERFORM public.record_anonymous_risk_event_by_user_id(
      actor_id,
      'anonymous_signup',
      jsonb_build_object('installation_key', normalized_installation_key)
    );
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.refresh_anonymous_abuse_status_by_key(normalized_installation_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_anonymous_matchmaking_allowed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.anonymous_risk_identities AS identity_row
    JOIN public.profiles AS profile
      ON profile.id = identity_row.current_user_id
    WHERE identity_row.current_user_id = p_user_id
      AND identity_row.last_decision = 'allow'
      AND (identity_row.cooldown_until IS NULL OR identity_row.cooldown_until <= timezone('utc'::text, now()))
      AND (identity_row.temporary_suspension_until IS NULL OR identity_row.temporary_suspension_until <= timezone('utc'::text, now()))
      AND profile.account_status = 'active'
      AND COALESCE(profile.onboarding_completed, FALSE) = TRUE
      AND COALESCE(profile.anonymous_mode_enabled, FALSE) = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.log_anonymous_report_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_anonymous_risk_event_by_user_id(
    NEW.reported_user_id,
    'report_received',
    jsonb_build_object(
      'report_id', NEW.id,
      'category', NEW.category,
      'status', NEW.status
    ),
    NULL,
    NEW.id,
    NEW.reported_user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS anonymous_report_risk_ai ON public.reports;
CREATE TRIGGER anonymous_report_risk_ai
AFTER INSERT ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.log_anonymous_report_risk();

CREATE OR REPLACE FUNCTION public.log_anonymous_block_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_anonymous_risk_event_by_user_id(
    NEW.blocked_user_id,
    'block_received',
    jsonb_build_object('block_id', NEW.id, 'blocker_id', NEW.blocker_id),
    NULL,
    NULL,
    NEW.blocked_user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS anonymous_block_risk_ai ON public.blocks;
CREATE TRIGGER anonymous_block_risk_ai
AFTER INSERT ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.log_anonymous_block_risk();

CREATE OR REPLACE FUNCTION public.log_anonymous_fraud_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_type TEXT := CASE
    WHEN NEW.risk_level = 'critical' THEN 'fraud_critical'
    WHEN NEW.risk_level = 'high' THEN 'fraud_high'
    WHEN NEW.risk_level = 'medium' THEN 'fraud_medium'
    ELSE 'fraud_low'
  END;
BEGIN
  PERFORM public.record_anonymous_risk_event_by_user_id(
    NEW.user_id,
    event_type,
    jsonb_build_object(
      'fraud_event_id', NEW.id,
      'risk_level', NEW.risk_level,
      'risk_types', COALESCE(NEW.risk_types, ARRAY[]::TEXT[])
    ),
    NEW.session_id,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS anonymous_fraud_risk_ai ON public.fraud_risk_events;
CREATE TRIGGER anonymous_fraud_risk_ai
AFTER INSERT ON public.fraud_risk_events
FOR EACH ROW
EXECUTE FUNCTION public.log_anonymous_fraud_risk();

CREATE OR REPLACE FUNCTION public.join_random_match_internal(
  p_actor_id UUID,
  p_excluded_user_id UUID DEFAULT NULL
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
  actor_profile RECORD;
  actor_session RECORD;
  candidate_user_id UUID;
  session_uuid UUID;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);

  SELECT
    profile.account_status,
    profile.onboarding_completed,
    profile.anonymous_mode_enabled,
    profile.anonymous_display_name,
    profile.anonymous_avatar
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF actor_profile.account_status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not eligible right now.';
  END IF;

  IF NOT COALESCE(actor_profile.onboarding_completed, FALSE) THEN
    RAISE EXCEPTION 'Complete onboarding first.';
  END IF;

  IF NOT COALESCE(actor_profile.anonymous_mode_enabled, FALSE) THEN
    RAISE EXCEPTION 'Anonymous mode is required.';
  END IF;

  IF btrim(COALESCE(actor_profile.anonymous_display_name, '')) = '' THEN
    RAISE EXCEPTION 'Anonymous display name is required.';
  END IF;

  IF btrim(COALESCE(actor_profile.anonymous_avatar, '')) = '' THEN
    RAISE EXCEPTION 'Anonymous avatar is required.';
  END IF;

  IF NOT public.is_anonymous_matchmaking_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible right now.';
  END IF;

  SELECT session_row.*
  INTO actor_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.status = 'active'
    AND (session_row.user_a = p_actor_id OR session_row.user_b = p_actor_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      'matched'::TEXT,
      actor_session.id,
      CASE
        WHEN actor_session.user_a = p_actor_id THEN actor_session.user_b
        ELSE actor_session.user_a
      END;
    RETURN;
  END IF;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status,
      joined_at = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at,
      matched_session_id = NULL;

  PERFORM public.record_anonymous_risk_event_by_user_id(
    p_actor_id,
    'queue_join',
    jsonb_build_object('excluded_user_id', p_excluded_user_id)
  );

  SELECT queue_row.user_id
  INTO candidate_user_id
  FROM public.random_match_queue AS queue_row
  JOIN public.profiles AS candidate_profile
    ON candidate_profile.id = queue_row.user_id
  WHERE queue_row.status = 'waiting'
    AND queue_row.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR queue_row.user_id <> p_excluded_user_id)
    AND candidate_profile.account_status = 'active'
    AND COALESCE(candidate_profile.onboarding_completed, FALSE) = TRUE
    AND COALESCE(candidate_profile.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate_profile.anonymous_display_name, '')) <> ''
    AND btrim(COALESCE(candidate_profile.anonymous_avatar, '')) <> ''
    AND public.is_anonymous_matchmaking_allowed(queue_row.user_id)
    AND NOT public.has_block_between(p_actor_id, queue_row.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS existing_session
      WHERE existing_session.status = 'active'
        AND (existing_session.user_a = queue_row.user_id OR existing_session.user_b = queue_row.user_id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_pair_history AS history
      WHERE history.pair_key = public.random_pair_key(p_actor_id, queue_row.user_id)
        AND history.matched_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
    )
  ORDER BY queue_row.joined_at ASC, queue_row.user_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();

    INSERT INTO public.random_chat_sessions (id, user_a, user_b, status, created_at)
    VALUES (
      session_uuid,
      LEAST(p_actor_id, candidate_user_id),
      GREATEST(p_actor_id, candidate_user_id),
      'active',
      timezone('utc'::text, now())
    );

    INSERT INTO public.random_pair_history (pair_key, user_a, user_b, matched_at)
    VALUES (
      public.random_pair_key(p_actor_id, candidate_user_id),
      LEAST(p_actor_id, candidate_user_id),
      GREATEST(p_actor_id, candidate_user_id),
      timezone('utc'::text, now())
    );

    UPDATE public.random_match_queue
    SET status = 'matched',
        updated_at = timezone('utc'::text, now()),
        matched_session_id = session_uuid
    WHERE user_id IN (p_actor_id, candidate_user_id);

    RETURN QUERY
    SELECT 'matched'::TEXT, session_uuid, candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'waiting'::TEXT, NULL::UUID, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_or_join_random_match()
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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));
  RETURN QUERY SELECT * FROM public.join_random_match_internal(actor_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_random_queue()
RETURNS TABLE (left_queue BOOLEAN)
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

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE user_id = actor_id
    AND status = 'waiting';

  PERFORM public.record_anonymous_risk_event_by_user_id(actor_id, 'queue_leave', '{}'::jsonb);

  RETURN QUERY SELECT TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_random_session(p_session_id UUID DEFAULT NULL)
RETURNS TABLE (ended BOOLEAN, session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_session_id UUID;
  target_session_status TEXT;
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT session_row.id, session_row.status
    INTO target_session_id, target_session_status
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.id = p_session_id
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
    LIMIT 1;
  ELSE
    SELECT session_row.id, session_row.status
    INTO target_session_id, target_session_status
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.status = 'active'
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
    LIMIT 1;
  END IF;

  IF target_session_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID;
    RETURN;
  END IF;

  IF target_session_status = 'active' THEN
    UPDATE public.random_chat_sessions
    SET status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'left'
    WHERE id = target_session_id
      AND status = 'active'
      AND (user_a = actor_id OR user_b = actor_id);

    GET DIAGNOSTICS updated_rows = ROW_COUNT;

    IF updated_rows = 0 THEN
      RAISE EXCEPTION 'You are not allowed to end this session.';
    END IF;
  ELSIF target_session_status <> 'ended' THEN
    RAISE EXCEPTION 'You are not allowed to end this session.';
  END IF;

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE user_id = actor_id;

  PERFORM public.record_anonymous_risk_event_by_user_id(actor_id, 'session_leave', jsonb_build_object('session_id', target_session_id::TEXT));

  RETURN QUERY SELECT TRUE, target_session_id;
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

  IF NOT public.is_anonymous_matchmaking_allowed(actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible right now.';
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

  PERFORM public.record_anonymous_risk_event_by_user_id(actor_id, 'next_match', jsonb_build_object('session_id', p_session_id::TEXT));

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

REVOKE ALL ON FUNCTION public.refresh_anonymous_abuse_status_by_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_anonymous_risk_event_by_user_id(UUID, TEXT, JSONB, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_anonymous_matchmaking_allowed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_report_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_block_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_fraud_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_random_match_internal(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_anonymous_abuse_identity(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_anonymous_abuse_identity(TEXT) TO authenticated;
