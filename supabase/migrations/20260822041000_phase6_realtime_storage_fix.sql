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
          AND NOT public.has_block_between(p_actor_id, photo.user_id)
          AND EXISTS (
            SELECT 1
            FROM public.public_profiles AS profile
            WHERE profile.id = photo.user_id
          )
        )
      )
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
