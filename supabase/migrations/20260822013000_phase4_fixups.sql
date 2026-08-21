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
  linked_user_count INTEGER := 0;
  existing_risk BOOLEAN := FALSE;
  row_id UUID;
  row_user_id UUID;
  row_device_hash TEXT;
  row_first_seen_at TIMESTAMPTZ;
  row_last_seen_at TIMESTAMPTZ;
  row_created_at TIMESTAMPTZ;
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
  INTO row_id, row_user_id, row_device_hash, row_first_seen_at, row_last_seen_at, row_created_at;

  SELECT COUNT(DISTINCT devices.user_id)
  INTO linked_user_count
  FROM public.devices
  WHERE devices.device_hash = btrim(p_device_hash);

  risk_signal_created := FALSE;

  IF linked_user_count >= 2 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.risk_events
      WHERE risk_events.user_id = actor_id
        AND risk_events.event_type = 'repeated_device_accounts'
        AND risk_events.metadata ->> 'device_hash' = btrim(p_device_hash)
    )
    INTO existing_risk;

    IF NOT existing_risk THEN
      PERFORM public.apply_risk_event(
        actor_id,
        'repeated_device_accounts',
        jsonb_build_object(
          'device_hash', btrim(p_device_hash),
          'linked_account_count', linked_user_count
        )
      );
      risk_signal_created := TRUE;
    END IF;
  END IF;

  id := row_id;
  user_id := row_user_id;
  device_hash := row_device_hash;
  first_seen_at := row_first_seen_at;
  last_seen_at := row_last_seen_at;
  created_at := row_created_at;

  RETURN NEXT;
END;
$$;

DROP POLICY IF EXISTS "Users can upload their own verification objects" ON storage.objects;
CREATE POLICY "Users can upload their own verification objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own verification objects" ON storage.objects;
CREATE POLICY "Users can update their own verification objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'verification-private'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own verification objects" ON storage.objects;
CREATE POLICY "Users can delete their own verification objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
