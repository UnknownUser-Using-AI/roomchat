-- Room images: the room owner (or an administrator) can set one picture per room.
-- Additive and safe to re-run. Run once in the Supabase SQL Editor.

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_image_path_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_image_path_check
  CHECK (image_path IS NULL OR image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('room-icons', 'room-icons', true, 716800, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 716800, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Uploads land in <room id>/ and only take effect through the checked RPC below.
DROP POLICY IF EXISTS "roomchat room icon upload" ON storage.objects;
CREATE POLICY "roomchat room icon upload" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'room-icons'
    AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.id::text = (storage.foldername(name))[1])
  );
DROP POLICY IF EXISTS "roomchat room icon admin delete" ON storage.objects;
CREATE POLICY "roomchat room icon admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'room-icons' AND public.roomchat_is_admin());

-- Returns the previous path. Pass NULL to remove the image.
CREATE OR REPLACE FUNCTION public.roomchat_set_room_image(
  p_room_id uuid, p_image_path text DEFAULT NULL, p_owner_token text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_creator uuid;
  v_old text;
  v_is_owner boolean := false;
BEGIN
  SELECT created_by, image_path INTO v_creator, v_old FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF auth.uid() IS NOT NULL AND v_creator = auth.uid() THEN v_is_owner := true; END IF;
  IF char_length(coalesce(p_owner_token, '')) >= 32 THEN
    PERFORM 1 FROM roomchat_private.room_owners
      WHERE room_id = p_room_id
        AND owner_token_sha256 = encode(extensions.digest(p_owner_token, 'sha256'), 'hex');
    IF FOUND THEN v_is_owner := true; END IF;
  END IF;
  IF NOT v_is_owner AND NOT roomchat_private.is_admin() THEN
    RAISE EXCEPTION '이 방의 운영자만 방 이미지를 바꿀 수 있습니다.';
  END IF;
  IF p_image_path IS NOT NULL AND (
    p_image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    OR split_part(p_image_path, '/', 1) <> p_room_id::text
    OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'room-icons' AND o.name = p_image_path)
  ) THEN
    RAISE EXCEPTION '방 이미지를 확인할 수 없습니다.';
  END IF;
  UPDATE public.rooms SET image_path = p_image_path WHERE id = p_room_id;
  RETURN v_old;
END
$function$;
REVOKE ALL ON FUNCTION public.roomchat_set_room_image(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roomchat_set_room_image(uuid, text, text) TO anon, authenticated;
