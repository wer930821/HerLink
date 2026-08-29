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
  FROM public.verifications
  WHERE user_id = v_actor_id
    AND created_at >= timezone('utc'::text, now()) - interval '1 day';

  IF v_submission_count >= 3 THEN
    PERFORM public.apply_risk_event(
      v_actor_id,
      'verification_submission_abuse',
      jsonb_build_object('daily_submission_count', v_submission_count)
    );
  END IF;

  RETURN QUERY
  SELECT
    v_submission_id,
    v_actor_id,
    v_status,
    p_method,
    v_media_path,
    v_submitted_at,
    v_created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_primary_photos(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  user_id UUID,
  storage_path TEXT,
  moderation_status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    photo.id,
    photo.user_id,
    photo.storage_path,
    photo.moderation_status,
    photo.created_at
  FROM public.profile_photos AS photo
  INNER JOIN public.public_profiles AS public_profile
    ON public_profile.id = photo.user_id
  INNER JOIN public.profiles AS private_profile
    ON private_profile.id = photo.user_id
  WHERE auth.uid() IS NOT NULL
    AND photo.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND photo.moderation_status = 'approved'
    AND photo.is_primary = TRUE
    AND private_profile.verified = TRUE
    AND public_profile.id <> auth.uid()
    AND NOT public.has_block_between(auth.uid(), photo.user_id);
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile_photos(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  user_id UUID,
  storage_path TEXT,
  sort_order INTEGER,
  is_primary BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    photo.id,
    photo.user_id,
    photo.storage_path,
    photo.sort_order,
    photo.is_primary,
    photo.created_at
  FROM public.profile_photos AS photo
  INNER JOIN public.public_profiles AS public_profile
    ON public_profile.id = photo.user_id
  INNER JOIN public.profiles AS private_profile
    ON private_profile.id = photo.user_id
  WHERE auth.uid() IS NOT NULL
    AND photo.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND photo.moderation_status = 'approved'
    AND private_profile.verified = TRUE
    AND public_profile.id <> auth.uid()
    AND NOT public.has_block_between(auth.uid(), photo.user_id)
  ORDER BY photo.user_id, photo.is_primary DESC, photo.sort_order, photo.created_at;
$$;
