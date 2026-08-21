CREATE OR REPLACE FUNCTION public.can_read_profile_photo_object(
  p_storage_path TEXT,
  p_actor_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_photos AS photo
    WHERE photo.storage_path = p_storage_path
      AND (
        photo.user_id = p_actor_id
        OR (
          photo.moderation_status = 'approved'
          AND photo.is_primary = TRUE
          AND NOT public.has_block_between(p_actor_id, photo.user_id)
        )
      )
  );
$$;

DROP FUNCTION IF EXISTS public.register_device(TEXT);

CREATE FUNCTION public.register_device(p_device_hash TEXT)
RETURNS TABLE (
  device_id UUID,
  owner_user_id UUID,
  device_hash_value TEXT,
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
  INTO device_id, owner_user_id, device_hash_value, first_seen_at, last_seen_at, created_at;

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

  RETURN NEXT;
END;
$$;

DROP POLICY IF EXISTS "Users can read allowed profile photo objects" ON storage.objects;
CREATE POLICY "Users can read allowed profile photo objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND public.can_read_profile_photo_object(name, auth.uid())
);

DROP POLICY IF EXISTS "Users can upload their own verification objects" ON storage.objects;
CREATE POLICY "Users can upload their own verification objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS "Users can update their own verification objects" ON storage.objects;
CREATE POLICY "Users can update their own verification objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND name LIKE auth.uid()::text || '/%'
)
WITH CHECK (
  bucket_id = 'verification-private'
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS "Users can delete their own verification objects" ON storage.objects;
CREATE POLICY "Users can delete their own verification objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND name LIKE auth.uid()::text || '/%'
);
