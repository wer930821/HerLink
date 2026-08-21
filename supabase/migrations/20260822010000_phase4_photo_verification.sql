ALTER TABLE public.risk_events
DROP CONSTRAINT IF EXISTS risk_events_event_type_valid;

ALTER TABLE public.risk_events
ADD CONSTRAINT risk_events_event_type_valid CHECK (
  event_type IN (
    'suspicious_money_message',
    'suspicious_investment_message',
    'suspicious_external_link',
    'repeated_message',
    'mass_messaging',
    'valid_report_received',
    'multiple_blocks_received',
    'credential_request',
    'repeated_device_accounts'
  )
);

CREATE TABLE IF NOT EXISTS public.profile_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profile_photos_moderation_status_valid CHECK (
    moderation_status IN ('pending', 'approved', 'rejected', 'under_review')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_photos_one_primary_per_user_idx
ON public.profile_photos (user_id)
WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS profile_photos_user_sort_idx
ON public.profile_photos (user_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS profile_photos_public_idx
ON public.profile_photos (user_id, moderation_status, is_primary);

CREATE TABLE IF NOT EXISTS public.verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  method TEXT NOT NULL,
  media_path TEXT NOT NULL UNIQUE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  media_delete_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT verifications_status_valid CHECK (
    status IN ('unverified', 'pending', 'verified', 'rejected', 'manual_review')
  ),
  CONSTRAINT verifications_method_valid CHECK (
    method IN ('liveness_manual', 'selfie_manual')
  )
);

CREATE INDEX IF NOT EXISTS verifications_user_created_idx
ON public.verifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT devices_hash_not_blank CHECK (length(btrim(device_hash)) >= 16),
  CONSTRAINT devices_user_hash_unique UNIQUE (user_id, device_hash)
);

CREATE INDEX IF NOT EXISTS devices_hash_idx ON public.devices (device_hash);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'verification-private',
  'verification-private',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

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
    WHEN 'repeated_device_accounts' THEN -10
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

CREATE OR REPLACE FUNCTION public.create_profile_photo(p_file_extension TEXT DEFAULT 'jpg')
RETURNS TABLE (
  id UUID,
  user_id UUID,
  storage_path TEXT,
  sort_order INTEGER,
  is_primary BOOLEAN,
  moderation_status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  next_order INTEGER := 0;
  photo_count INTEGER := 0;
  file_extension TEXT := lower(regexp_replace(COALESCE(p_file_extension, 'jpg'), '[^a-z0-9]', '', 'g'));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT COUNT(*), COALESCE(MAX(profile_photos.sort_order), -1) + 1
  INTO photo_count, next_order
  FROM public.profile_photos
  WHERE profile_photos.user_id = actor_id;

  IF photo_count >= 6 THEN
    RAISE EXCEPTION 'You can only keep up to 6 profile photos.';
  END IF;

  IF file_extension NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    file_extension := 'jpg';
  END IF;

  id := gen_random_uuid();
  user_id := actor_id;
  storage_path := actor_id::text || '/' || id::text || '.' || file_extension;
  sort_order := next_order;
  is_primary := photo_count = 0;
  moderation_status := 'pending';

  INSERT INTO public.profile_photos (id, user_id, storage_path, sort_order, is_primary, moderation_status)
  VALUES (id, user_id, storage_path, sort_order, is_primary, moderation_status)
  RETURNING profile_photos.created_at INTO created_at;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_primary_profile_photo(p_photo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_user_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT user_id
  INTO target_user_id
  FROM public.profile_photos
  WHERE id = p_photo_id;

  IF target_user_id IS NULL OR target_user_id <> actor_id THEN
    RAISE EXCEPTION 'Photo not found.';
  END IF;

  UPDATE public.profile_photos
  SET is_primary = CASE WHEN id = p_photo_id THEN TRUE ELSE FALSE END
  WHERE user_id = actor_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_profile_photos(p_photo_ids UUID[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  expected_count INTEGER := 0;
  actual_count INTEGER := 0;
  current_photo_id UUID;
  current_index INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT COUNT(*)
  INTO expected_count
  FROM public.profile_photos
  WHERE user_id = actor_id;

  actual_count := COALESCE(array_length(p_photo_ids, 1), 0);

  IF expected_count <> actual_count THEN
    RAISE EXCEPTION 'Photo order payload is incomplete.';
  END IF;

  FOREACH current_photo_id IN ARRAY p_photo_ids LOOP
    UPDATE public.profile_photos
    SET sort_order = current_index
    WHERE id = current_photo_id
      AND user_id = actor_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Photo order contains an invalid photo.';
    END IF;

    current_index := current_index + 1;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_profile_photo(p_photo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_photo RECORD;
  replacement_photo_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO target_photo
  FROM public.profile_photos
  WHERE id = p_photo_id
    AND user_id = actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Photo not found.';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'profile-photos'
    AND name = target_photo.storage_path;

  DELETE FROM public.profile_photos
  WHERE id = p_photo_id
    AND user_id = actor_id;

  IF target_photo.is_primary THEN
    SELECT id
    INTO replacement_photo_id
    FROM public.profile_photos
    WHERE user_id = actor_id
    ORDER BY sort_order, created_at
    LIMIT 1;

    IF replacement_photo_id IS NOT NULL THEN
      UPDATE public.profile_photos
      SET is_primary = CASE WHEN id = replacement_photo_id THEN TRUE ELSE FALSE END
      WHERE user_id = actor_id;
    END IF;
  END IF;

  RETURN TRUE;
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
  WHERE auth.uid() IS NOT NULL
    AND photo.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND photo.moderation_status = 'approved'
    AND photo.is_primary = TRUE
    AND NOT public.has_block_between(auth.uid(), photo.user_id);
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
  file_extension TEXT := lower(regexp_replace(COALESCE(p_file_extension, 'jpg'), '[^a-z0-9]', '', 'g'));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_method NOT IN ('liveness_manual', 'selfie_manual') THEN
    RAISE EXCEPTION 'Unsupported verification method.';
  END IF;

  IF file_extension NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    file_extension := 'jpg';
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
  verification_row public.verifications%ROWTYPE;
  verified_value BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can review verification.';
  END IF;

  IF p_status NOT IN ('verified', 'rejected', 'manual_review') THEN
    RAISE EXCEPTION 'Unsupported review status.';
  END IF;

  UPDATE public.verifications
  SET status = p_status,
      reviewed_at = timezone('utc'::text, now()),
      rejection_reason = CASE WHEN p_status = 'rejected' THEN NULLIF(BTRIM(COALESCE(p_rejection_reason, '')), '') ELSE NULL END,
      media_delete_after = timezone('utc'::text, now()) + interval '30 days'
  WHERE id = p_verification_id
  RETURNING * INTO verification_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found.';
  END IF;

  verified_value := p_status = 'verified';
  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET verified = verified_value
  WHERE profiles.id = verification_row.user_id;

  verification_id := verification_row.id;
  user_id := verification_row.user_id;
  status := verification_row.status;
  reviewed_at := verification_row.reviewed_at;
  profile_verified := verified_value;

  RETURN NEXT;
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
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can clean verification media.';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'verification-private'
    AND name IN (
      SELECT media_path
      FROM public.verifications
      WHERE media_path IS NOT NULL
        AND media_delete_after IS NOT NULL
        AND media_delete_after <= p_now
    );

  UPDATE public.verifications
  SET media_path = NULL,
      metadata = metadata || jsonb_build_object('media_cleaned_at', p_now)
  WHERE media_path IS NOT NULL
    AND media_delete_after IS NOT NULL
    AND media_delete_after <= p_now;

  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_device(p_device_hash TEXT)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  device_hash TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  risk_signal_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  user_count INTEGER := 0;
  existing_risk BOOLEAN := FALSE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF length(btrim(COALESCE(p_device_hash, ''))) < 16 THEN
    RAISE EXCEPTION 'Device hash is invalid.';
  END IF;

  INSERT INTO public.devices (user_id, device_hash)
  VALUES (actor_id, btrim(p_device_hash))
  ON CONFLICT (user_id, device_hash)
  DO UPDATE SET last_seen_at = timezone('utc'::text, now())
  RETURNING
    devices.id,
    devices.user_id,
    devices.device_hash,
    devices.first_seen_at,
    devices.last_seen_at,
    devices.created_at
  INTO id, user_id, device_hash, first_seen_at, last_seen_at, created_at;

  SELECT COUNT(DISTINCT devices.user_id)
  INTO user_count
  FROM public.devices
  WHERE devices.device_hash = btrim(p_device_hash);

  risk_signal_created := FALSE;

  IF user_count >= 2 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.risk_events
      WHERE user_id = actor_id
        AND event_type = 'repeated_device_accounts'
        AND metadata ->> 'device_hash' = btrim(p_device_hash)
    )
    INTO existing_risk;

    IF NOT existing_risk THEN
      PERFORM public.apply_risk_event(
        actor_id,
        'repeated_device_accounts',
        jsonb_build_object(
          'device_hash', btrim(p_device_hash),
          'linked_account_count', user_count
        )
      );
      risk_signal_created := TRUE;
    END IF;
  END IF;

  RETURN NEXT;
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
DECLARE
  target_photo public.profile_photos%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can moderate profile photos.';
  END IF;

  UPDATE public.profile_photos
  SET moderation_status = 'under_review'
  WHERE id = p_photo_id
  RETURNING * INTO target_photo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile photo not found.';
  END IF;

  PERFORM public.apply_risk_event(
    target_photo.user_id,
    'valid_report_received',
    jsonb_build_object(
      'photo_id', p_photo_id,
      'reason', NULLIF(BTRIM(COALESCE(p_reason, '')), '')
    )
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON public.profile_photos FROM public, anon;
REVOKE ALL ON public.verifications FROM public, anon;
REVOKE ALL ON public.devices FROM public, anon;

GRANT SELECT ON public.profile_photos TO authenticated, service_role;
GRANT SELECT ON public.verifications TO authenticated, service_role;
GRANT SELECT ON public.devices TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.profile_photos TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.verifications TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.devices TO service_role;

GRANT EXECUTE ON FUNCTION public.create_profile_photo(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_primary_profile_photo(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_profile_photos(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_profile_photo(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_primary_photos(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_verification_submission(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_device(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_verification(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_verification_media(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_photo_under_review(UUID, TEXT) TO service_role;

DROP POLICY IF EXISTS "Users can read their own profile photos" ON public.profile_photos;
CREATE POLICY "Users can read their own profile photos"
ON public.profile_photos
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own verifications" ON public.verifications;
CREATE POLICY "Users can read their own verifications"
ON public.verifications
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own devices" ON public.devices;
CREATE POLICY "Users can read their own devices"
ON public.devices
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can upload their own profile photo objects" ON storage.objects;
CREATE POLICY "Users can upload their own profile photo objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.profile_photos AS photo
    WHERE photo.user_id = auth.uid()
      AND photo.storage_path = name
  )
);

DROP POLICY IF EXISTS "Users can update their own profile photo objects" ON storage.objects;
CREATE POLICY "Users can update their own profile photo objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND EXISTS (
    SELECT 1
    FROM public.profile_photos AS photo
    WHERE photo.user_id = auth.uid()
      AND photo.storage_path = name
  )
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND EXISTS (
    SELECT 1
    FROM public.profile_photos AS photo
    WHERE photo.user_id = auth.uid()
      AND photo.storage_path = name
  )
);

DROP POLICY IF EXISTS "Users can delete their own profile photo objects" ON storage.objects;
CREATE POLICY "Users can delete their own profile photo objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND EXISTS (
    SELECT 1
    FROM public.profile_photos AS photo
    WHERE photo.user_id = auth.uid()
      AND photo.storage_path = name
  )
);

DROP POLICY IF EXISTS "Users can read allowed profile photo objects" ON storage.objects;
CREATE POLICY "Users can read allowed profile photo objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (
    EXISTS (
      SELECT 1
      FROM public.profile_photos AS photo
      WHERE photo.user_id = auth.uid()
        AND photo.storage_path = name
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_photos AS photo
      WHERE photo.storage_path = name
        AND photo.moderation_status = 'approved'
        AND photo.is_primary = TRUE
        AND NOT public.has_block_between(auth.uid(), photo.user_id)
    )
  )
);

DROP POLICY IF EXISTS "Users can upload their own verification objects" ON storage.objects;
CREATE POLICY "Users can upload their own verification objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.verifications AS verification
    WHERE verification.user_id = auth.uid()
      AND verification.media_path = name
  )
);

DROP POLICY IF EXISTS "Users can update their own verification objects" ON storage.objects;
CREATE POLICY "Users can update their own verification objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND EXISTS (
    SELECT 1
    FROM public.verifications AS verification
    WHERE verification.user_id = auth.uid()
      AND verification.media_path = name
  )
)
WITH CHECK (
  bucket_id = 'verification-private'
  AND EXISTS (
    SELECT 1
    FROM public.verifications AS verification
    WHERE verification.user_id = auth.uid()
      AND verification.media_path = name
  )
);

DROP POLICY IF EXISTS "Users can delete their own verification objects" ON storage.objects;
CREATE POLICY "Users can delete their own verification objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND EXISTS (
    SELECT 1
    FROM public.verifications AS verification
    WHERE verification.user_id = auth.uid()
      AND verification.media_path = name
  )
);
