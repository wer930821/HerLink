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
  v_actor_id UUID := auth.uid();
  v_file_extension TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_file_extension), ''), 'jpg'));
  v_submission_id UUID;
  v_submission_count INTEGER := 0;
  v_status TEXT := 'pending';
  v_media_path TEXT;
  v_submitted_at TIMESTAMPTZ := timezone('utc'::text, now());
  v_created_at TIMESTAMPTZ;
BEGIN
  IF v_actor_id IS NULL THEN
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

  IF NOT public.is_profile_eligible(v_actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible to submit verification.';
  END IF;

  v_submission_id := gen_random_uuid();
  v_media_path := v_actor_id::text || '/' || v_submission_id::text || '/verification.' || v_file_extension;

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
    v_submission_id,
    v_actor_id,
    v_status,
    p_method,
    v_media_path,
    v_submitted_at,
    timezone('utc'::text, now())
  )
  RETURNING verifications.created_at
  INTO v_created_at;

  SELECT COUNT(*)
  INTO v_submission_count
  FROM public.verifications AS verification_row
  WHERE verification_row.user_id = v_actor_id
    AND verification_row.created_at >= timezone('utc'::text, now()) - interval '1 day';

  IF v_submission_count >= 3 THEN
    PERFORM public.apply_risk_event(
      v_actor_id,
      'verification_submission_abuse',
      jsonb_build_object('daily_submission_count', v_submission_count)
    );
  END IF;

  RETURN QUERY
  SELECT
    v_submission_id AS id,
    v_actor_id AS user_id,
    v_status AS status,
    p_method AS method,
    v_media_path AS media_path,
    v_submitted_at AS submitted_at,
    v_created_at AS created_at;
END;
$$;
