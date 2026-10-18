-- Profile photos for accounts and the pinned "설명 방".
-- Additive: existing rooms, messages and profiles are left untouched.

ALTER TABLE public.roomchat_profiles
  ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE public.roomchat_profiles
  DROP CONSTRAINT IF EXISTS roomchat_profiles_avatar_path_check;
ALTER TABLE public.roomchat_profiles
  ADD CONSTRAINT roomchat_profiles_avatar_path_check
  CHECK (avatar_path IS NULL OR avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

-- Public bucket: the public URL works without a SELECT policy, so files cannot be listed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 1048576,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "roomchat avatar upload" ON storage.objects;
CREATE POLICY "roomchat avatar upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
DROP POLICY IF EXISTS "roomchat avatar delete" ON storage.objects;
CREATE POLICY "roomchat avatar delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Profiles are write-protected, so the avatar is set through a checked RPC.
-- Returns the previous path so the browser can remove the old file.
CREATE OR REPLACE FUNCTION public.roomchat_set_my_avatar(p_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_old text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
       OR split_part(p_path, '/', 1) <> v_uid::text
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'avatars' AND o.name = p_path
       ) THEN
      RAISE EXCEPTION '프로필 사진을 확인할 수 없습니다.';
    END IF;
  END IF;
  SELECT p.avatar_path INTO v_old FROM public.roomchat_profiles p WHERE p.id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.';
  END IF;
  UPDATE public.roomchat_profiles SET avatar_path = p_path, updated_at = now() WHERE id = v_uid;
  RETURN v_old;
END
$function$;
REVOKE ALL ON FUNCTION public.roomchat_set_my_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roomchat_set_my_avatar(text) TO authenticated;

-- Pinned explanation room. The intro text itself is rendered by the web app.
INSERT INTO public.rooms (name, is_featured)
VALUES ('설명 방', true)
ON CONFLICT (name) DO UPDATE SET is_featured = true;
