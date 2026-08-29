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
