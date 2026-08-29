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

  UPDATE public.matches AS match_row
  SET status = 'blocked'
  WHERE match_row.status = 'active'
    AND (match_row.user_1_id = LEAST(actor_id, target_user_id) AND match_row.user_2_id = GREATEST(actor_id, target_user_id));

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
  status TEXT,
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
  INTO report_id, status, created_at
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
    INTO report_id, status, created_at;
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
