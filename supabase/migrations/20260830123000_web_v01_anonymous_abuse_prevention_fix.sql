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
    UPDATE public.anonymous_risk_identities AS identity_row
    SET
      current_user_id = actor_id,
      first_user_id = COALESCE(identity_row.first_user_id, actor_id),
      last_seen_at = timezone('utc'::text, now()),
      last_account_rotation_at = CASE
        WHEN identity_row.current_user_id IS DISTINCT FROM actor_id THEN timezone('utc'::text, now())
        ELSE identity_row.last_account_rotation_at
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

REVOKE ALL ON FUNCTION public.refresh_anonymous_abuse_status_by_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_anonymous_risk_event_by_user_id(UUID, TEXT, JSONB, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_anonymous_matchmaking_allowed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_report_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_block_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_anonymous_fraud_risk() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_random_match_internal(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_anonymous_abuse_identity(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_anonymous_abuse_identity(TEXT) TO authenticated;
