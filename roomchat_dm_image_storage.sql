-- Private storage for images shared in direct messages.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dm-images', 'dm-images', false, 8388608,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "roomchat dm image upload" ON storage.objects;
CREATE POLICY "roomchat dm image upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'dm-images'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9_-]{1,128}\.(jpg|png|webp|gif|avif)$'
  AND EXISTS (
    SELECT 1 FROM public.roomchat_friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.requester = (SELECT auth.uid()) AND f.addressee = ((storage.foldername(name))[2])::uuid)
        OR
        (f.addressee = (SELECT auth.uid()) AND f.requester = ((storage.foldername(name))[2])::uuid)
      )
  )
);

DROP POLICY IF EXISTS "roomchat dm image read friends" ON storage.objects;
CREATE POLICY "roomchat dm image read friends" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'dm-images'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  AND EXISTS (
    SELECT 1 FROM public.roomchat_friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.requester = ((storage.foldername(name))[1])::uuid AND f.addressee = ((storage.foldername(name))[2])::uuid)
        OR
        (f.addressee = ((storage.foldername(name))[1])::uuid AND f.requester = ((storage.foldername(name))[2])::uuid)
      )
      AND (SELECT auth.uid()) IN (
        ((storage.foldername(name))[1])::uuid,
        ((storage.foldername(name))[2])::uuid
      )
  )
);

DROP POLICY IF EXISTS "roomchat dm image delete own" ON storage.objects;
CREATE POLICY "roomchat dm image delete own" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'dm-images'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
