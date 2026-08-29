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
    AND reports.created_at >= timezone('utc'::text, now()) - interval '1 hour';

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
