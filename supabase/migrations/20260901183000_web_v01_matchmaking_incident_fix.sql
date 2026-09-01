-- Matchmaking incident fix:
-- A new anonymous user on an existing installation must not inherit the
-- previous user's risk events, cooldown, or suspension. Risk is now scoped to
-- the current user's tenure on the installation. Rapid account-cycling is still
-- detected via a short 30-minute rotation window so abuse protection remains.

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
  current_status TEXT;
  next_status TEXT;
  latest_manual_status_action TEXT;
  existing_row RECORD;
  active_temporary_suspensions INTEGER := 0;
  active_permanent_bans INTEGER := 0;
  expired_temporary_suspensions INTEGER := 0;
  rotation_count INTEGER := 0;
  rotation_recent_count INTEGER := 0;
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
  rotation_cutoff TIMESTAMPTZ := NULL;
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
  rotation_cutoff := COALESCE(existing_row.last_account_rotation_at, existing_row.first_seen_at);

  IF actor_id IS NOT NULL THEN
    UPDATE public.moderation_enforcements AS enforcement
    SET status = 'expired'
    WHERE enforcement.subject_user_id = actor_id
      AND enforcement.status = 'active'
      AND enforcement.enforcement_type = 'temporary_suspension'
      AND enforcement.expires_at IS NOT NULL
      AND enforcement.expires_at <= timezone('utc'::text, now());

    SELECT profile.account_status
    INTO current_status
    FROM public.profiles AS profile
    WHERE profile.id = actor_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target profile not found.';
    END IF;

    SELECT COUNT(*)
    INTO active_temporary_suspensions
    FROM public.moderation_enforcements AS enforcement
    WHERE enforcement.subject_user_id = actor_id
      AND enforcement.status = 'active'
      AND enforcement.enforcement_type = 'temporary_suspension'
      AND (enforcement.expires_at IS NULL OR enforcement.expires_at > timezone('utc'::text, now()));

    SELECT COUNT(*)
    INTO active_permanent_bans
    FROM public.moderation_enforcements AS enforcement
    WHERE enforcement.subject_user_id = actor_id
      AND enforcement.status = 'active'
      AND enforcement.enforcement_type = 'permanent_ban';

    SELECT COUNT(*)
    INTO expired_temporary_suspensions
    FROM public.moderation_enforcements AS enforcement
    WHERE enforcement.subject_user_id = actor_id
      AND enforcement.status = 'expired'
      AND enforcement.enforcement_type = 'temporary_suspension';

    SELECT moderation_log.action
    INTO latest_manual_status_action
    FROM public.moderation_logs AS moderation_log
    WHERE moderation_log.target_user_id = actor_id
      AND moderation_log.action IN ('account_suspended', 'account_restored')
    ORDER BY moderation_log.created_at DESC
    LIMIT 1;

    next_status := current_status;

    IF current_status <> 'deletion_pending' THEN
      IF active_permanent_bans > 0 OR active_temporary_suspensions > 0 THEN
        next_status := 'suspended';
      ELSIF current_status = 'suspended'
        AND expired_temporary_suspensions > 0
        AND COALESCE(latest_manual_status_action, 'account_restored') <> 'account_suspended' THEN
        next_status := 'active';
      END IF;
    END IF;

    IF next_status IS DISTINCT FROM current_status THEN
      PERFORM set_config('herlink.internal_profile_update', 'on', true);

      UPDATE public.profiles AS profile
      SET account_status = next_status
      WHERE profile.id = actor_id;

      IF next_status = 'active' THEN
        PERFORM public.internal_write_moderation_log(
          NULL,
          NULL,
          actor_id,
          'account_restored',
          'Temporary suspension expired.',
          jsonb_build_object(
            'reconciled_by', 'anonymous_abuse_refresh',
            'expired_temporary_suspensions', expired_temporary_suspensions
          )
        );
      END IF;
    END IF;

    current_status := next_status;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN event_type = 'anonymous_account_rotation' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'queue_join' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'queue_leave' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'next_match' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'session_leave' AND created_at >= timezone('utc'::text, now()) - INTERVAL '15 minutes' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'report_received' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'block_received' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_low' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_medium' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_high' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'fraud_critical' AND created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours' AND created_at >= rotation_cutoff THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'anonymous_account_rotation' AND created_at >= timezone('utc'::text, now()) - INTERVAL '30 minutes' THEN 1 ELSE 0 END), 0)
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
    fraud_critical_count,
    rotation_recent_count
  FROM public.anonymous_risk_events AS risk_event
  WHERE risk_event.installation_key = p_installation_key;

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

  IF current_status IS DISTINCT FROM 'active' THEN
    next_decision := 'blocked';
    next_reason_code := 'account_restricted';
  ELSIF existing_row.temporary_suspension_until IS NOT NULL
    AND existing_row.temporary_suspension_until > timezone('utc'::text, now())
    AND existing_row.temporary_suspension_until - INTERVAL '24 hours' >= rotation_cutoff THEN
    next_decision := 'temporary_suspension';
    next_reason_code := 'temporary_suspension_active';
    next_temporary_until := existing_row.temporary_suspension_until;
    next_review_required := TRUE;
  ELSIF existing_row.cooldown_until IS NOT NULL
    AND existing_row.cooldown_until > timezone('utc'::text, now())
    AND existing_row.cooldown_until - INTERVAL '15 minutes' >= rotation_cutoff THEN
    next_decision := 'cooldown';
    next_reason_code := 'cooldown_active';
    next_cooldown_until := existing_row.cooldown_until;
  ELSIF computed_score >= 10
    OR rotation_count >= 3
    OR rotation_recent_count >= 3
    OR report_received_count >= 5
    OR block_received_count >= 3
    OR fraud_critical_count >= 1 THEN
    next_decision := 'temporary_suspension';
    next_reason_code := 'anonymous_abuse_high_risk';
    next_temporary_until := timezone('utc'::text, now()) + INTERVAL '24 hours';
    next_review_required := TRUE;
  ELSIF computed_score >= 5
    OR rotation_count >= 2
    OR rotation_recent_count >= 2
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

  UPDATE public.anonymous_risk_identities AS identity_row
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
      ELSE identity_row.cooldown_until
    END,
    temporary_suspension_until = CASE
      WHEN next_decision = 'temporary_suspension' THEN next_temporary_until
      WHEN next_decision = 'allow' THEN NULL
      ELSE identity_row.temporary_suspension_until
    END
  WHERE identity_row.installation_key = p_installation_key;

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

-- When a new anonymous user attaches to an existing installation, do not inherit
-- the previous user's cooldown/suspension state.
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
    UPDATE public.anonymous_risk_identities AS identity_row
    SET
      current_user_id = actor_id,
      first_user_id = COALESCE(identity_row.first_user_id, actor_id),
      last_seen_at = timezone('utc'::text, now()),
      last_account_rotation_at = CASE
        WHEN identity_row.current_user_id IS DISTINCT FROM actor_id THEN timezone('utc'::text, now())
        ELSE identity_row.last_account_rotation_at
      END,
      cooldown_until = CASE
        WHEN identity_row.current_user_id IS DISTINCT FROM actor_id THEN NULL
        ELSE identity_row.cooldown_until
      END,
      temporary_suspension_until = CASE
        WHEN identity_row.current_user_id IS DISTINCT FROM actor_id THEN NULL
        ELSE identity_row.temporary_suspension_until
      END
    WHERE identity_row.installation_key = normalized_installation_key;

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

-- Do not record queue_join when the user is already waiting (avoids inflating
-- the 15-minute activity signal from repeated clicks / reconnects).
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
  was_waiting BOOLEAN := FALSE;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);
  PERFORM public.reconcile_anonymous_matchmaking_identity(p_actor_id);

  SELECT profile.account_status, profile.onboarding_completed, profile.anonymous_mode_enabled, profile.anonymous_display_name
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF actor_profile.account_status <> 'active' THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;
  IF NOT COALESCE(actor_profile.onboarding_completed, FALSE) THEN RAISE EXCEPTION 'Complete onboarding first.'; END IF;
  IF NOT COALESCE(actor_profile.anonymous_mode_enabled, FALSE) THEN RAISE EXCEPTION 'Anonymous mode is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_display_name, '')) = '' THEN RAISE EXCEPTION 'Anonymous display name is required.'; END IF;
  IF NOT public.is_anonymous_matchmaking_allowed(p_actor_id) THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;

  SELECT session_row.* INTO actor_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.status = 'active' AND (session_row.user_a = p_actor_id OR session_row.user_b = p_actor_id)
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'matched'::TEXT, actor_session.id,
      CASE WHEN actor_session.user_a = p_actor_id THEN actor_session.user_b ELSE actor_session.user_a END;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.random_match_queue AS queue_row
    WHERE queue_row.user_id = p_actor_id AND queue_row.status = 'waiting'
  ) INTO was_waiting;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, joined_at = EXCLUDED.joined_at,
    updated_at = EXCLUDED.updated_at, matched_session_id = NULL;

  IF NOT was_waiting THEN
    PERFORM public.record_anonymous_risk_event_by_user_id(
      p_actor_id, 'queue_join', jsonb_build_object('excluded_user_id', p_excluded_user_id)
    );
  END IF;

  SELECT queue_row.user_id INTO candidate_user_id
  FROM public.random_match_queue AS queue_row
  JOIN public.profiles AS candidate_profile ON candidate_profile.id = queue_row.user_id
  WHERE queue_row.status = 'waiting'
    AND queue_row.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR queue_row.user_id <> p_excluded_user_id)
    AND candidate_profile.account_status = 'active'
    AND COALESCE(candidate_profile.onboarding_completed, FALSE) = TRUE
    AND COALESCE(candidate_profile.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate_profile.anonymous_display_name, '')) <> ''
    AND public.is_anonymous_matchmaking_allowed(queue_row.user_id)
    AND NOT public.has_block_between(p_actor_id, queue_row.user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.random_chat_sessions AS existing_session
      WHERE existing_session.status = 'active'
        AND (existing_session.user_a = queue_row.user_id OR existing_session.user_b = queue_row.user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.random_pair_history AS history
      WHERE history.pair_key = public.random_pair_key(p_actor_id, queue_row.user_id)
        AND history.matched_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
    )
  ORDER BY queue_row.joined_at ASC, queue_row.user_id ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();
    INSERT INTO public.random_chat_sessions (id, user_a, user_b, status, created_at)
    VALUES (session_uuid, LEAST(p_actor_id, candidate_user_id), GREATEST(p_actor_id, candidate_user_id), 'active', timezone('utc'::text, now()));
    INSERT INTO public.random_pair_history (pair_key, user_a, user_b, matched_at)
    VALUES (public.random_pair_key(p_actor_id, candidate_user_id), LEAST(p_actor_id, candidate_user_id), GREATEST(p_actor_id, candidate_user_id), timezone('utc'::text, now()));
    UPDATE public.random_match_queue SET status = 'matched', updated_at = timezone('utc'::text, now()), matched_session_id = session_uuid
    WHERE user_id IN (p_actor_id, candidate_user_id);
    RETURN QUERY SELECT 'matched'::TEXT, session_uuid, candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'waiting'::TEXT, NULL::UUID, NULL::UUID;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_anonymous_abuse_identity(TEXT) TO authenticated, service_role;
