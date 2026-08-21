DROP POLICY IF EXISTS "Users can upload their own verification objects" ON storage.objects;
CREATE POLICY "Users can upload their own verification objects"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "Users can update their own verification objects" ON storage.objects;
CREATE POLICY "Users can update their own verification objects"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
)
WITH CHECK (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "Users can delete their own verification objects" ON storage.objects;
CREATE POLICY "Users can delete their own verification objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'verification-private'
  AND auth.uid() IS NOT NULL
);
