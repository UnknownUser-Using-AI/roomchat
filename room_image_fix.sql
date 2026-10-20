-- Fix: let the room-image function see uploaded files in the public room-icons bucket.
DROP POLICY IF EXISTS "roomchat room icon read" ON storage.objects;
CREATE POLICY "roomchat room icon read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'room-icons');
