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
      JOIN public.public_profiles AS profile
        ON profile.id = photo.user_id
      WHERE photo.storage_path = name
        AND photo.moderation_status = 'approved'
        AND profile.id <> auth.uid()
        AND NOT public.has_block_between(auth.uid(), profile.id)
    )
  )
);
