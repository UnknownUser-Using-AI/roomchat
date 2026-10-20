-- Roomchat social migration: profile styling, bio/notes, friends, DMs, shared image tags,
-- timed kicks, and deleting your own messages. Additive: rooms, messages and accounts are kept.
-- Run once in the Supabase SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Profile styling (font / weight / color) and bio
-- ---------------------------------------------------------------------------
ALTER TABLE public.roomchat_profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS nick_font text,
  ADD COLUMN IF NOT EXISTS nick_weight smallint,
  ADD COLUMN IF NOT EXISTS nick_color text;
ALTER TABLE public.roomchat_profiles DROP CONSTRAINT IF EXISTS roomchat_profiles_style_check;
ALTER TABLE public.roomchat_profiles ADD CONSTRAINT roomchat_profiles_style_check CHECK (
  (bio IS NULL OR char_length(bio) <= 190)
  AND (nick_font IS NULL OR nick_font ~ '^[A-Za-z0-9 ]{1,40}$')
  AND (nick_weight IS NULL OR nick_weight IN (400, 500, 600, 700, 800, 900))
  AND (nick_color IS NULL OR nick_color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE OR REPLACE FUNCTION public.roomchat_update_my_style(
  p_font text, p_weight integer, p_color text, p_bio text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF v_bio IS NOT NULL AND (char_length(v_bio) > 190 OR v_bio ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION '소개는 190자 이내의 한 줄로 입력해 주세요.';
  END IF;
  IF p_font IS NOT NULL AND p_font !~ '^[A-Za-z0-9 ]{1,40}$' THEN
    RAISE EXCEPTION '글꼴을 확인할 수 없습니다.';
  END IF;
  IF p_weight IS NOT NULL AND p_weight NOT IN (400, 500, 600, 700, 800, 900) THEN
    RAISE EXCEPTION '글자 굵기를 확인할 수 없습니다.';
  END IF;
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION '닉네임 색을 확인할 수 없습니다.';
  END IF;
  UPDATE public.roomchat_profiles
    SET bio = v_bio, nick_font = p_font, nick_weight = p_weight,
        nick_color = lower(p_color), updated_at = now()
    WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.'; END IF;
  RETURN true;
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Private memos about other users (only the author can read them)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roomchat_user_notes (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, target_id)
);
ALTER TABLE public.roomchat_user_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roomchat_user_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roomchat_user_notes TO authenticated;
DROP POLICY IF EXISTS "roomchat notes are private" ON public.roomchat_user_notes;
CREATE POLICY "roomchat notes are private" ON public.roomchat_user_notes
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.roomchat_set_note(p_target uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF p_target IS NULL OR p_target = auth.uid() THEN RAISE EXCEPTION '다른 사람의 프로필에만 메모를 남길 수 있어요.'; END IF;
  IF v_note IS NULL THEN
    DELETE FROM public.roomchat_user_notes WHERE owner_id = auth.uid() AND target_id = p_target;
    RETURN true;
  END IF;
  IF char_length(v_note) > 200 THEN RAISE EXCEPTION '메모는 200자 이내로 입력해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roomchat_profiles WHERE id = p_target) THEN
    RAISE EXCEPTION '계정 이용자에게만 메모를 남길 수 있어요.';
  END IF;
  INSERT INTO public.roomchat_user_notes(owner_id, target_id, note)
    VALUES (auth.uid(), p_target, v_note)
  ON CONFLICT (owner_id, target_id) DO UPDATE SET note = excluded.note, updated_at = now();
  RETURN true;
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Friends (account holders only) and direct messages between friends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roomchat_friendships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roomchat_friendship_not_self CHECK (requester <> addressee)
);
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_friendships_pair_uidx
  ON public.roomchat_friendships (LEAST(requester, addressee), GREATEST(requester, addressee));
CREATE INDEX IF NOT EXISTS roomchat_friendships_addressee_idx ON public.roomchat_friendships (addressee);
ALTER TABLE public.roomchat_friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roomchat_friendships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roomchat_friendships TO authenticated;
DROP POLICY IF EXISTS "roomchat friendships are visible to both sides" ON public.roomchat_friendships;
CREATE POLICY "roomchat friendships are visible to both sides" ON public.roomchat_friendships
  FOR SELECT TO authenticated
  USING (requester = (SELECT auth.uid()) OR addressee = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.roomchat_dms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roomchat_dms_recipient_idx ON public.roomchat_dms (recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS roomchat_dms_sender_idx ON public.roomchat_dms (sender, created_at DESC);
ALTER TABLE public.roomchat_dms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roomchat_dms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roomchat_dms TO authenticated;
DROP POLICY IF EXISTS "roomchat dms are visible to both sides" ON public.roomchat_dms;
CREATE POLICY "roomchat dms are visible to both sides" ON public.roomchat_dms
  FOR SELECT TO authenticated
  USING (sender = (SELECT auth.uid()) OR recipient = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.roomchat_friend_request(p_target uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_row public.roomchat_friendships%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF p_target IS NULL OR p_target = v_me THEN RAISE EXCEPTION '자기 자신에게는 친구 요청을 보낼 수 없어요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roomchat_profiles WHERE id = p_target) THEN
    RAISE EXCEPTION '계정을 만든 이용자만 친구로 추가할 수 있어요.';
  END IF;
  SELECT * INTO v_row FROM public.roomchat_friendships f
    WHERE (f.requester = v_me AND f.addressee = p_target) OR (f.requester = p_target AND f.addressee = v_me);
  IF FOUND THEN
    IF v_row.status = 'accepted' THEN RAISE EXCEPTION '이미 친구예요.'; END IF;
    IF v_row.requester = v_me THEN RAISE EXCEPTION '이미 친구 요청을 보냈어요.'; END IF;
    UPDATE public.roomchat_friendships SET status = 'accepted' WHERE id = v_row.id;
    RETURN 'accepted';
  END IF;
  IF (SELECT count(*) FROM public.roomchat_friendships f WHERE f.requester = v_me AND f.status = 'pending') >= 30 THEN
    RAISE EXCEPTION '보낸 친구 요청이 너무 많아요. 상대가 수락하거나 요청을 취소한 뒤 다시 시도해 주세요.';
  END IF;
  INSERT INTO public.roomchat_friendships(requester, addressee) VALUES (v_me, p_target);
  RETURN 'pending';
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_friend_respond(p_other uuid, p_accept boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF coalesce(p_accept, false) THEN
    UPDATE public.roomchat_friendships SET status = 'accepted'
      WHERE requester = p_other AND addressee = v_me AND status = 'pending';
  ELSE
    DELETE FROM public.roomchat_friendships
      WHERE requester = p_other AND addressee = v_me AND status = 'pending';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION '처리할 친구 요청이 없어요.'; END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_friend_remove(p_other uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  DELETE FROM public.roomchat_friendships
    WHERE (requester = v_me AND addressee = p_other) OR (requester = p_other AND addressee = v_me);
  RETURN FOUND;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_send_dm(p_to uuid, p_content text)
RETURNS public.roomchat_dms
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_row public.roomchat_dms%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF v_content IS NULL THEN RAISE EXCEPTION '메시지를 입력해 주세요.'; END IF;
  IF char_length(v_content) > 2000 THEN RAISE EXCEPTION '메시지는 2000자 이내로 입력해 주세요.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.roomchat_friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester = v_me AND f.addressee = p_to) OR (f.requester = p_to AND f.addressee = v_me))
  ) THEN
    RAISE EXCEPTION '친구끼리만 DM을 보낼 수 있어요.';
  END IF;
  INSERT INTO public.roomchat_dms(sender, recipient, content) VALUES (v_me, p_to, v_content) RETURNING * INTO v_row;
  RETURN v_row;
END
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roomchat_dms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roomchat_dms;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roomchat_friendships') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roomchat_friendships;
  END IF;
END
$$;
ALTER TABLE public.roomchat_friendships REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 4. Shared image tags (anyone with an account can create; many users can wear the same tag)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roomchat_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 12),
  name_key text GENERATED ALWAYS AS (lower(name)) STORED,
  image_path text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_tags_name_key_uidx ON public.roomchat_tags (name_key);
CREATE TABLE IF NOT EXISTS public.roomchat_user_tags (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.roomchat_tags(id) ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tag_id)
);
CREATE INDEX IF NOT EXISTS roomchat_user_tags_tag_idx ON public.roomchat_user_tags (tag_id);
ALTER TABLE public.roomchat_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roomchat_user_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roomchat_tags, public.roomchat_user_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roomchat_tags, public.roomchat_user_tags TO anon, authenticated;
DROP POLICY IF EXISTS "roomchat tags are public" ON public.roomchat_tags;
CREATE POLICY "roomchat tags are public" ON public.roomchat_tags FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "roomchat worn tags are public" ON public.roomchat_user_tags;
CREATE POLICY "roomchat worn tags are public" ON public.roomchat_user_tags FOR SELECT TO anon, authenticated USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tags', 'tags', true, 524288, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 524288, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];
DROP POLICY IF EXISTS "roomchat tag upload" ON storage.objects;
CREATE POLICY "roomchat tag upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tags' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "roomchat tag delete" ON storage.objects;
CREATE POLICY "roomchat tag delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tags' AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR public.roomchat_is_admin()));

CREATE OR REPLACE FUNCTION public.roomchat_create_tag(p_name text, p_image_path text)
RETURNS public.roomchat_tags
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := normalize(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'), NFC);
  v_row public.roomchat_tags%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roomchat_profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 12 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '태그 이름은 1~12자로 입력해 주세요.';
  END IF;
  IF position('인증됨' IN v_name) > 0 THEN
    RAISE EXCEPTION '인증됨 이름은 태그로 만들 수 없어요.';
  END IF;
  IF roomchat_private.is_weird_nickname(v_name) THEN
    RAISE EXCEPTION '사용할 수 없는 태그 이름이에요.';
  END IF;
  IF (SELECT count(*) FROM public.roomchat_tags t WHERE t.created_by = v_uid) >= 10 THEN
    RAISE EXCEPTION '태그는 계정당 10개까지 만들 수 있어요.';
  END IF;
  IF p_image_path IS NULL
     OR p_image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
     OR split_part(p_image_path, '/', 1) <> v_uid::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'tags' AND o.name = p_image_path) THEN
    RAISE EXCEPTION '태그 이미지를 확인할 수 없습니다.';
  END IF;
  BEGIN
    INSERT INTO public.roomchat_tags(name, image_path, created_by) VALUES (v_name, p_image_path, v_uid) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '같은 이름의 태그가 이미 있어요. 목록에서 골라 쓸 수 있어요.';
  END;
  RETURN v_row;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_set_my_tags(p_tag_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF coalesce(array_length(p_tag_ids, 1), 0) > 3 THEN RAISE EXCEPTION '태그는 최대 3개까지 달 수 있어요.'; END IF;
  DELETE FROM public.roomchat_user_tags WHERE user_id = v_uid;
  INSERT INTO public.roomchat_user_tags(user_id, tag_id, position)
    SELECT v_uid, t.id, o.ord::smallint
    FROM unnest(coalesce(p_tag_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS o(tag_id, ord)
    JOIN public.roomchat_tags t ON t.id = o.tag_id
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$function$;

-- Returns the image path so the browser can remove the file afterwards.
CREATE OR REPLACE FUNCTION public.roomchat_delete_tag(p_tag_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  DELETE FROM public.roomchat_tags t
    WHERE t.id = p_tag_id AND (t.created_by = auth.uid() OR roomchat_private.is_admin())
    RETURNING t.image_path INTO v_path;
  IF v_path IS NULL THEN RAISE EXCEPTION '내가 만든 태그만 삭제할 수 있어요.'; END IF;
  RETURN v_path;
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Timed kicks (1 minute / 5 minutes / 1 day)
-- ---------------------------------------------------------------------------
ALTER TABLE roomchat_private.room_kicks ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE roomchat_private.room_kicks SET expires_at = created_at + interval '1 day' WHERE expires_at IS NULL;
ALTER TABLE roomchat_private.room_kicks ALTER COLUMN expires_at SET DEFAULT (now() + interval '1 day');
ALTER TABLE roomchat_private.room_kicks ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE FUNCTION roomchat_private.is_kicked_now(p_room_id uuid, p_user_id uuid, p_guest uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM roomchat_private.room_kicks k
    WHERE k.room_id = p_room_id AND k.expires_at > now()
      AND ((p_user_id IS NOT NULL AND k.user_id = p_user_id)
        OR (p_guest IS NOT NULL AND k.guest_session_id = p_guest))
  )
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_track_member(
  p_room_id uuid, p_guest_session_id uuid DEFAULT NULL, p_guest_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_nickname text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_room_id) THEN
    RAISE EXCEPTION '방을 찾을 수 없습니다.';
  END IF;
  DELETE FROM roomchat_private.active_members WHERE updated_at < now() - interval '1 day';
  IF v_user_id IS NOT NULL THEN
    SELECT nickname INTO v_nickname FROM public.roomchat_profiles WHERE id = v_user_id;
    IF v_nickname IS NULL THEN RAISE EXCEPTION '계정 닉네임을 확인할 수 없습니다.'; END IF;
    IF roomchat_private.is_kicked_now(p_room_id, v_user_id, NULL) THEN
      RAISE EXCEPTION '이 방의 운영자가 참여를 제한했습니다.';
    END IF;
    INSERT INTO roomchat_private.active_members(room_id, user_id, updated_at)
      VALUES (p_room_id, v_user_id, now())
      ON CONFLICT (room_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET updated_at = now();
  ELSE
    UPDATE roomchat_private.guest_sessions
      SET updated_at = now(), expires_at = now() + interval '12 hours'
      WHERE session_id = p_guest_session_id
        AND expires_at > now()
        AND token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
      RETURNING nickname INTO v_nickname;
    IF v_nickname IS NULL THEN RAISE EXCEPTION '게스트 이름을 먼저 정해 주세요.'; END IF;
    IF roomchat_private.is_kicked_now(p_room_id, NULL, p_guest_session_id) THEN
      RAISE EXCEPTION '이 방의 운영자가 참여를 제한했습니다.';
    END IF;
    INSERT INTO roomchat_private.active_members(room_id, guest_session_id, updated_at)
      VALUES (p_room_id, p_guest_session_id, now())
      ON CONFLICT (room_id, guest_session_id) WHERE guest_session_id IS NOT NULL DO UPDATE SET updated_at = now();
  END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_list_members(p_room_id uuid)
RETURNS TABLE(user_id uuid, guest_session_id uuid, nickname text, is_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT a.user_id, a.guest_session_id, coalesce(p.nickname, g.nickname), coalesce(p.is_verified, false)
  FROM roomchat_private.active_members a
  LEFT JOIN public.roomchat_profiles p ON p.id = a.user_id
  LEFT JOIN roomchat_private.guest_sessions g ON g.session_id = a.guest_session_id
  WHERE a.room_id = p_room_id
    AND a.updated_at > now() - interval '70 seconds'
    AND ((a.user_id IS NOT NULL AND p.id IS NOT NULL
          AND NOT roomchat_private.is_kicked_now(a.room_id, a.user_id, NULL))
      OR (a.guest_session_id IS NOT NULL AND g.session_id IS NOT NULL AND g.expires_at > now()
          AND NOT roomchat_private.is_kicked_now(a.room_id, NULL, a.guest_session_id)))
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_post_message(
  p_room_id uuid, p_content text DEFAULT NULL, p_image_path text DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL, p_guest_token text DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nickname text;
  v_user_id uuid := auth.uid();
  v_row public.messages%ROWTYPE;
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = p_room_id) THEN
    RAISE EXCEPTION '이 방은 더 이상 존재하지 않습니다.';
  END IF;
  IF v_content IS NOT NULL AND char_length(v_content) > 2000 THEN
    RAISE EXCEPTION '메시지는 2000자 이내로 입력해 주세요.';
  END IF;
  IF v_content IS NULL AND p_image_path IS NULL THEN
    RAISE EXCEPTION '메시지나 이미지를 입력해 주세요.';
  END IF;
  IF p_image_path IS NOT NULL AND p_image_path NOT LIKE p_room_id::text || '/%' THEN
    RAISE EXCEPTION '이미지 경로가 현재 방과 일치하지 않습니다.';
  END IF;
  IF v_user_id IS NOT NULL THEN
    SELECT nickname INTO v_nickname FROM public.roomchat_profiles WHERE id = v_user_id;
    IF v_nickname IS NULL THEN RAISE EXCEPTION '계정 닉네임을 확인할 수 없습니다.'; END IF;
    IF roomchat_private.is_kicked_now(p_room_id, v_user_id, NULL) THEN
      RAISE EXCEPTION '이 방의 운영자가 참여를 제한했습니다.';
    END IF;
  ELSE
    SELECT nickname INTO v_nickname FROM roomchat_private.guest_sessions
      WHERE session_id = p_guest_session_id
        AND token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        AND expires_at > now();
    IF v_nickname IS NULL THEN RAISE EXCEPTION '게스트 이름을 먼저 정해 주세요.'; END IF;
    IF roomchat_private.is_kicked_now(p_room_id, NULL, p_guest_session_id) THEN
      RAISE EXCEPTION '이 방의 운영자가 참여를 제한했습니다.';
    END IF;
  END IF;
  INSERT INTO public.messages(room_id, nickname, content, image_path, user_id, guest_session_id, is_verified)
    VALUES (p_room_id, v_nickname, v_content, p_image_path, v_user_id,
            CASE WHEN v_user_id IS NULL THEN p_guest_session_id ELSE NULL END,
            roomchat_private.is_admin())
    RETURNING * INTO v_row;
  RETURN v_row;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_is_kicked(
  p_room_id uuid, p_guest_session_id uuid DEFAULT NULL, p_guest_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN roomchat_private.is_kicked_now(p_room_id, auth.uid(), NULL);
  END IF;
  IF p_guest_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM roomchat_private.guest_sessions g
    WHERE g.session_id = p_guest_session_id
      AND g.token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
      AND g.expires_at > now()
  ) THEN RETURN false; END IF;
  RETURN roomchat_private.is_kicked_now(p_room_id, NULL, p_guest_session_id);
END
$function$;

-- The old signature is replaced (an overload would make the RPC ambiguous).
DROP FUNCTION IF EXISTS public.roomchat_kick_member(uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.roomchat_kick_member(
  p_room_id uuid, p_user_id uuid DEFAULT NULL, p_guest_session_id uuid DEFAULT NULL,
  p_owner_token text DEFAULT NULL, p_minutes integer DEFAULT 1440
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_creator uuid;
  v_is_owner boolean := false;
  v_is_admin boolean := roomchat_private.is_admin();
  v_owner_session uuid;
  v_until timestamptz;
BEGIN
  IF (p_user_id IS NULL) = (p_guest_session_id IS NULL) THEN
    RAISE EXCEPTION '추방 대상 한 명을 선택해 주세요.';
  END IF;
  IF p_minutes IS NULL OR p_minutes NOT IN (1, 5, 1440) THEN
    RAISE EXCEPTION '추방 시간은 1분, 5분, 하루 중에서 선택해 주세요.';
  END IF;
  SELECT created_by INTO v_creator FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF auth.uid() IS NOT NULL AND v_creator = auth.uid() THEN v_is_owner := true; END IF;
  IF char_length(coalesce(p_owner_token, '')) >= 32 THEN
    SELECT owner_session_id INTO v_owner_session FROM roomchat_private.room_owners
      WHERE room_id = p_room_id
        AND owner_token_sha256 = encode(extensions.digest(p_owner_token, 'sha256'), 'hex');
    v_is_owner := FOUND;
  END IF;
  IF NOT v_is_admin AND NOT v_is_owner THEN RAISE EXCEPTION '이 방의 운영자만 참여자를 추방할 수 있습니다.'; END IF;
  IF (auth.uid() IS NOT NULL AND p_user_id = auth.uid())
     OR (auth.uid() IS NULL AND v_is_owner AND p_guest_session_id = v_owner_session) THEN
    RAISE EXCEPTION '방장은 자기 자신을 추방할 수 없습니다.';
  END IF;
  IF p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM roomchat_private.member_roles WHERE user_id = p_user_id AND role = 'admin') THEN
    RAISE EXCEPTION '인증된 관리자는 추방할 수 없습니다.';
  END IF;
  v_until := now() + make_interval(mins => p_minutes);
  IF p_user_id IS NOT NULL THEN
    INSERT INTO roomchat_private.room_kicks(room_id, user_id, kicked_by, expires_at)
      VALUES (p_room_id, p_user_id, auth.uid(), v_until)
    ON CONFLICT (room_id, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET expires_at = excluded.expires_at, kicked_by = excluded.kicked_by, created_at = now();
  ELSE
    INSERT INTO roomchat_private.room_kicks(room_id, guest_session_id, kicked_by, expires_at)
      VALUES (p_room_id, p_guest_session_id, auth.uid(), v_until)
    ON CONFLICT (room_id, guest_session_id) WHERE guest_session_id IS NOT NULL
      DO UPDATE SET expires_at = excluded.expires_at, kicked_by = excluded.kicked_by, created_at = now();
  END IF;
  DELETE FROM roomchat_private.active_members
    WHERE room_id = p_room_id AND ((p_user_id IS NOT NULL AND user_id = p_user_id)
      OR (p_guest_session_id IS NOT NULL AND guest_session_id = p_guest_session_id));
  RETURN true;
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Delete your own message
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roomchat_delete_my_message(
  p_message_id bigint, p_guest_session_id uuid DEFAULT NULL, p_guest_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    DELETE FROM public.messages WHERE id = p_message_id AND user_id = auth.uid();
  ELSE
    IF p_guest_session_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM roomchat_private.guest_sessions g
      WHERE g.session_id = p_guest_session_id
        AND g.token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        AND g.expires_at > now()
    ) THEN
      RAISE EXCEPTION '게스트 세션이 만료되었습니다.';
    END IF;
    DELETE FROM public.messages WHERE id = p_message_id AND user_id IS NULL AND guest_session_id = p_guest_session_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION '내가 보낸 메시지만 삭제할 수 있어요.'; END IF;
  RETURN true;
END
$function$;

-- Logged-in authors may remove the image of their own message (guests' files stay until an admin clears the room).
DROP POLICY IF EXISTS "roomchat authors delete own images" ON storage.objects;
CREATE POLICY "roomchat authors delete own images" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.image_path = storage.objects.name AND m.user_id = (SELECT auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 7. Function grants: only signed-in users run account features
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.roomchat_update_my_style(text, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_set_note(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_friend_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_friend_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_friend_remove(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_send_dm(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_create_tag(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_set_my_tags(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roomchat_delete_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roomchat_update_my_style(text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_set_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_friend_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_friend_remove(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_send_dm(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_create_tag(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_set_my_tags(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_delete_tag(uuid) TO authenticated;
-- Kick, post, track, list, is_kicked and delete-my-message keep working for guests (anon + authenticated).
GRANT EXECUTE ON FUNCTION public.roomchat_kick_member(uuid, uuid, uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_delete_my_message(bigint, uuid, text) TO anon, authenticated;
