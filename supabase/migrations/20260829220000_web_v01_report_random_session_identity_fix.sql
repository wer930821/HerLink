ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS random_session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_random_session_id_idx
  ON public.reports (random_session_id, created_at DESC);

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
    AND existing_report.random_session_id = p_session_id
    AND existing_report.category = p_category
    AND COALESCE(existing_report.description, '') = COALESCE(normalized_description, '')
    AND existing_report.created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
  ORDER BY existing_report.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    blocked := FALSE;
  ELSE
    INSERT INTO public.reports AS report_row (
      reporter_id,
      reported_user_id,
      random_session_id,
      category,
      description,
      status
    )
    VALUES (
      actor_id,
      target_user_id,
      p_session_id,
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
