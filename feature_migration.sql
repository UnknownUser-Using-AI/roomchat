-- Roomchat feature migration: preserves existing rooms/messages and adds secure account,
-- guest identity, room ownership, moderation, and rate-limit primitives.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS roomchat_private;
REVOKE ALL ON SCHEMA roomchat_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.roomchat_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 24),
  nickname_key text GENERATED ALWAYS AS (lower(nickname)) STORED,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_profiles_nickname_key_uidx
  ON public.roomchat_profiles (nickname_key);
ALTER TABLE public.roomchat_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roomchat profiles are readable" ON public.roomchat_profiles;
CREATE POLICY "roomchat profiles are readable" ON public.roomchat_profiles
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.roomchat_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.roomchat_profiles TO anon, authenticated;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_session_id uuid,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS roomchat_private.member_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roomchat_private.admin_invites (
  nickname text PRIMARY KEY CHECK (nickname IN ('[인증됨] 천사', '[인증됨] 크리스탈')),
  code_sha256 text NOT NULL CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_by uuid UNIQUE,
  claimed_at timestamptz
);
INSERT INTO roomchat_private.admin_invites (nickname, code_sha256) VALUES
  ('[인증됨] 천사', '5a7d625d7dc02f0df5216d92390b61f7a52dc0c5d51bfc2863aee426fbd33535'),
  ('[인증됨] 크리스탈', '8f87f474c890c42d0a392da7ef0a7fde030fe74998bf6e9883ed3bbe64fc1078')
ON CONFLICT (nickname) DO NOTHING;

CREATE TABLE IF NOT EXISTS roomchat_private.guest_sessions (
  session_id uuid PRIMARY KEY,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  nickname text NOT NULL,
  nickname_key text GENERATED ALWAYS AS (lower(nickname)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 hours')
);
-- The live lease window changes with time, so active guest-name uniqueness is enforced
-- inside the security-definer claim routine rather than with a clock-dependent index.
CREATE INDEX IF NOT EXISTS roomchat_guest_nickname_idx
  ON roomchat_private.guest_sessions (nickname_key, expires_at);
CREATE TABLE IF NOT EXISTS roomchat_private.active_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_session_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roomchat_active_member_exactly_one_identity CHECK ((user_id IS NOT NULL) <> (guest_session_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_active_members_user_uidx
  ON roomchat_private.active_members(room_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_active_members_guest_uidx
  ON roomchat_private.active_members(room_id, guest_session_id) WHERE guest_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS roomchat_private.room_owners (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  owner_session_id uuid NOT NULL,
  owner_token_sha256 text NOT NULL CHECK (owner_token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roomchat_private.room_kicks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_session_id uuid,
  kicked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roomchat_kick_exactly_one_identity CHECK ((user_id IS NOT NULL) <> (guest_session_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_kicks_user_uidx
  ON roomchat_private.room_kicks(room_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roomchat_kicks_guest_uidx
  ON roomchat_private.room_kicks(room_id, guest_session_id) WHERE guest_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS roomchat_private.auth_rate_limits (
  key_hash text NOT NULL,
  bucket text NOT NULL,
  window_started timestamptz NOT NULL,
  hit_count integer NOT NULL,
  PRIMARY KEY (key_hash, bucket)
);
CREATE INDEX IF NOT EXISTS roomchat_auth_rate_limits_window_idx
  ON roomchat_private.auth_rate_limits (window_started);
REVOKE ALL ON ALL TABLES IN SCHEMA roomchat_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION roomchat_private.is_weird_nickname(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_name IS NULL
    OR char_length(btrim(p_name)) < 1
    OR char_length(btrim(p_name)) > 24
    OR p_name ~ '[[:cntrl:]]'
    OR p_name ~* '(https?://|www[.]|[[:space:]]{3,})'
    OR p_name ~* '(시발|씨발|좆|개새끼|병신|fuck|shit)'
    OR char_length(regexp_replace(p_name, '[[:punct:][:space:]]', '', 'g')) < greatest(1, floor(char_length(p_name) * 0.45)::integer)
$function$;

CREATE OR REPLACE FUNCTION roomchat_private.allocate_nickname(
  p_requested text,
  p_guest_session_id uuid DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_requested text := normalize(regexp_replace(btrim(coalesce(p_requested, '')), '[[:space:]]+', ' ', 'g'), NFC);
  v_base text;
  v_candidate text;
  v_suffix integer;
  v_used boolean;
BEGIN
  IF position('인증됨' IN v_requested) > 0
     OR lower(v_requested) IN ('[인증됨] 천사', '[인증됨] 크리스탈')
     OR roomchat_private.is_weird_nickname(v_requested) THEN
    v_base := '크리스탈 시청자';
  ELSE
    v_base := v_requested;
  END IF;

  IF v_base <> '크리스탈 시청자' THEN
    PERFORM pg_advisory_xact_lock(hashtext(lower(v_base)));
    SELECT EXISTS (
      SELECT 1 FROM public.roomchat_profiles p
      WHERE p.nickname_key = lower(v_base)
        AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
    ) OR EXISTS (
      SELECT 1 FROM roomchat_private.guest_sessions g
      WHERE g.nickname_key = lower(v_base)
        AND g.expires_at > now()
        AND (p_guest_session_id IS NULL OR g.session_id <> p_guest_session_id)
    ) INTO v_used;
    IF NOT v_used THEN RETURN v_base; END IF;
    v_base := '크리스탈 시청자';
  END IF;

  FOR v_suffix IN 0..999 LOOP
    IF v_suffix = 0 THEN
      v_candidate := v_base;
    ELSE
      v_candidate := left(v_base, greatest(1, 24 - char_length(' ' || (v_suffix + 1)::text))) || ' ' || (v_suffix + 1)::text;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext(lower(v_candidate)));
    IF NOT EXISTS (
      SELECT 1 FROM public.roomchat_profiles p
      WHERE p.nickname_key = lower(v_candidate)
        AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
    ) AND NOT EXISTS (
      SELECT 1 FROM roomchat_private.guest_sessions g
      WHERE g.nickname_key = lower(v_candidate)
        AND g.expires_at > now()
        AND (p_guest_session_id IS NULL OR g.session_id <> p_guest_session_id)
    ) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RETURN '크리스탈 시청자 ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
END
$function$;

CREATE OR REPLACE FUNCTION roomchat_private.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM roomchat_private.member_roles r
    WHERE r.user_id = auth.uid() AND r.role = 'admin'
  )
$function$;

CREATE OR REPLACE FUNCTION roomchat_private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_name text;
  v_claim_code text;
  v_invite roomchat_private.admin_invites%ROWTYPE;
  v_effective text;
BEGIN
  IF coalesce(new.raw_app_meta_data ->> 'roomchat_managed', 'false') <> 'true' THEN
    RETURN new;
  END IF;

  v_name := normalize(regexp_replace(btrim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '[[:space:]]+', ' ', 'g'), NFC);
  IF char_length(v_name) < 1 OR char_length(v_name) > 24 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '닉네임은 1~24자로 입력해 주세요.';
  END IF;

  IF v_name IN ('[인증됨] 천사', '[인증됨] 크리스탈') THEN
    v_claim_code := coalesce(new.raw_user_meta_data ->> 'admin_claim_code', '');
    SELECT * INTO v_invite
    FROM roomchat_private.admin_invites i
    WHERE i.nickname = v_name AND i.claimed_by IS NULL
      AND i.code_sha256 = encode(extensions.digest(v_claim_code, 'sha256'), 'hex')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '이 관리자 닉네임은 올바른 1회용 초대 코드가 필요합니다.';
    END IF;
    INSERT INTO public.roomchat_profiles(id, nickname, is_verified)
    VALUES (new.id, v_name, true);
    INSERT INTO roomchat_private.member_roles(user_id, role) VALUES (new.id, 'admin');
    UPDATE roomchat_private.admin_invites
      SET claimed_by = new.id, claimed_at = now()
      WHERE nickname = v_name;
    UPDATE auth.users
      SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'admin_claim_code'
      WHERE id = new.id;
  ELSE
    IF position('인증됨' IN v_name) > 0 THEN
      RAISE EXCEPTION '인증됨 표시는 지정된 두 관리자 계정만 사용할 수 있습니다.';
    END IF;
    v_effective := roomchat_private.allocate_nickname(v_name, NULL, NULL);
    INSERT INTO public.roomchat_profiles(id, nickname, is_verified)
    VALUES (new.id, v_effective, false);
    UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(v_effective), true)
      WHERE id = new.id;
  END IF;
  RETURN new;
END
$function$;
DROP TRIGGER IF EXISTS roomchat_auth_user_created ON auth.users;
CREATE TRIGGER roomchat_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION roomchat_private.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.roomchat_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT roomchat_private.is_admin()
$function$;
REVOKE ALL ON FUNCTION public.roomchat_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roomchat_is_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.roomchat_consume_rate_limit(
  p_key_hash text, p_bucket text, p_limit integer, p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_allowed boolean;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$' OR p_bucket NOT IN ('register', 'login')
     OR p_limit < 1 OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;
  INSERT INTO roomchat_private.auth_rate_limits(key_hash, bucket, window_started, hit_count)
    VALUES (p_key_hash, p_bucket, now(), 1)
  ON CONFLICT (key_hash, bucket) DO UPDATE SET
    window_started = CASE
      WHEN roomchat_private.auth_rate_limits.window_started + make_interval(secs => p_window_seconds) <= now()
      THEN now() ELSE roomchat_private.auth_rate_limits.window_started END,
    hit_count = CASE
      WHEN roomchat_private.auth_rate_limits.window_started + make_interval(secs => p_window_seconds) <= now()
      THEN 1 ELSE roomchat_private.auth_rate_limits.hit_count + 1 END
  RETURNING hit_count <= p_limit INTO v_allowed;
  DELETE FROM roomchat_private.auth_rate_limits WHERE window_started < now() - interval '1 day';
  RETURN v_allowed;
END
$function$;
REVOKE ALL ON FUNCTION public.roomchat_consume_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_consume_rate_limit(text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.roomchat_claim_guest_nickname(
  p_guest_session_id uuid, p_guest_token text, p_requested text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hash text;
  v_existing text;
  v_name text;
BEGIN
  IF p_guest_session_id IS NULL OR p_guest_token IS NULL OR char_length(p_guest_token) < 32 THEN
    RAISE EXCEPTION '게스트 세션을 확인할 수 없습니다.';
  END IF;
  v_hash := encode(extensions.digest(p_guest_token, 'sha256'), 'hex');
  SELECT token_sha256 INTO v_existing FROM roomchat_private.guest_sessions
    WHERE session_id = p_guest_session_id FOR UPDATE;
  IF FOUND AND v_existing <> v_hash THEN
    RAISE EXCEPTION '게스트 세션이 다른 기기에서 사용 중입니다.';
  END IF;
  DELETE FROM roomchat_private.guest_sessions WHERE expires_at <= now();
  v_name := roomchat_private.allocate_nickname(p_requested, p_guest_session_id, NULL);
  INSERT INTO roomchat_private.guest_sessions(session_id, token_sha256, nickname, updated_at, expires_at)
    VALUES (p_guest_session_id, v_hash, v_name, now(), now() + interval '12 hours')
  ON CONFLICT (session_id) DO UPDATE
    SET nickname = EXCLUDED.nickname, updated_at = now(), expires_at = now() + interval '12 hours'
    WHERE roomchat_private.guest_sessions.token_sha256 = v_hash;
  RETURN v_name;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_refresh_guest(
  p_guest_session_id uuid, p_guest_token text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_name text;
BEGIN
  UPDATE roomchat_private.guest_sessions
    SET updated_at = now(), expires_at = now() + interval '12 hours'
    WHERE session_id = p_guest_session_id
      AND expires_at > now()
      AND token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
    RETURNING nickname INTO v_name;
  IF v_name IS NULL THEN RAISE EXCEPTION '게스트 세션이 만료되었습니다.'; END IF;
  RETURN v_name;
END
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
    IF EXISTS (SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = p_room_id AND k.user_id = v_user_id) THEN
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
    IF EXISTS (SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = p_room_id AND k.guest_session_id = p_guest_session_id) THEN
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
    AND ((a.user_id IS NOT NULL AND p.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = a.room_id AND k.user_id = a.user_id
    )) OR (a.guest_session_id IS NOT NULL AND g.session_id IS NOT NULL AND g.expires_at > now() AND NOT EXISTS (
      SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = a.room_id AND k.guest_session_id = a.guest_session_id
    )))
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_create_room(
  p_name text,
  p_guest_session_id uuid DEFAULT NULL,
  p_guest_token text DEFAULT NULL,
  p_owner_token text DEFAULT NULL
)
RETURNS public.rooms
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_name text := normalize(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'), NFC);
  v_room public.rooms%ROWTYPE;
  v_guest_hash text;
BEGIN
  IF char_length(v_name) < 2 OR char_length(v_name) > 32 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '방 이름은 2~32자로 입력해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rooms r WHERE lower(r.name) = lower(v_name)) THEN
    RAISE EXCEPTION '같은 이름의 방이 이미 있어요.';
  END IF;
  IF auth.uid() IS NULL THEN
    IF p_guest_session_id IS NULL OR char_length(coalesce(p_owner_token, '')) < 32 THEN
      RAISE EXCEPTION '게스트 방장 정보를 확인할 수 없습니다.';
    END IF;
    SELECT token_sha256 INTO v_guest_hash FROM roomchat_private.guest_sessions
      WHERE session_id = p_guest_session_id
        AND token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        AND expires_at > now();
    IF v_guest_hash IS NULL THEN RAISE EXCEPTION '게스트 세션이 만료되었습니다.'; END IF;
  END IF;
  INSERT INTO public.rooms(name, created_by, is_featured)
    VALUES (v_name, auth.uid(), false) RETURNING * INTO v_room;
  IF auth.uid() IS NULL THEN
    INSERT INTO roomchat_private.room_owners(room_id, owner_session_id, owner_token_sha256)
      VALUES (v_room.id, p_guest_session_id, encode(extensions.digest(p_owner_token, 'sha256'), 'hex'));
  END IF;
  RETURN v_room;
END
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
    IF EXISTS (SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = p_room_id AND k.user_id = v_user_id) THEN
      RAISE EXCEPTION '이 방의 운영자가 참여를 제한했습니다.';
    END IF;
  ELSE
    SELECT nickname INTO v_nickname FROM roomchat_private.guest_sessions
      WHERE session_id = p_guest_session_id
        AND token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        AND expires_at > now();
    IF v_nickname IS NULL THEN RAISE EXCEPTION '게스트 이름을 먼저 정해 주세요.'; END IF;
    IF EXISTS (SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = p_room_id AND k.guest_session_id = p_guest_session_id) THEN
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
    RETURN EXISTS (SELECT 1 FROM roomchat_private.room_kicks k WHERE k.room_id = p_room_id AND k.user_id = auth.uid());
  END IF;
  IF p_guest_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM roomchat_private.guest_sessions g
    WHERE g.session_id = p_guest_session_id
      AND g.token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
      AND g.expires_at > now()
  ) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM roomchat_private.room_kicks k
    WHERE k.room_id = p_room_id AND k.guest_session_id = p_guest_session_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_update_my_nickname(p_requested text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  IF roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자 인증 닉네임은 보호되어 있어 변경할 수 없습니다.'; END IF;
  v_name := roomchat_private.allocate_nickname(p_requested, NULL, auth.uid());
  UPDATE public.roomchat_profiles SET nickname = v_name, updated_at = now(), is_verified = false WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.'; END IF;
  RETURN v_name;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_kick_member(
  p_room_id uuid, p_user_id uuid DEFAULT NULL, p_guest_session_id uuid DEFAULT NULL,
  p_owner_token text DEFAULT NULL
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
BEGIN
  IF (p_user_id IS NULL) = (p_guest_session_id IS NULL) THEN
    RAISE EXCEPTION '추방 대상 한 명을 선택해 주세요.';
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
  INSERT INTO roomchat_private.room_kicks(room_id, user_id, guest_session_id, kicked_by)
    VALUES (p_room_id, p_user_id, p_guest_session_id, auth.uid())
  ON CONFLICT DO NOTHING;
  DELETE FROM roomchat_private.active_members
    WHERE room_id = p_room_id AND ((p_user_id IS NOT NULL AND user_id = p_user_id)
      OR (p_guest_session_id IS NOT NULL AND guest_session_id = p_guest_session_id));
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_admin_rename_guest(p_guest_session_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_name text;
BEGIN
  IF NOT roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자만 닉네임을 정리할 수 있습니다.'; END IF;
  v_name := roomchat_private.allocate_nickname('크리스탈 시청자', p_guest_session_id, NULL);
  UPDATE roomchat_private.guest_sessions SET nickname = v_name, updated_at = now(), expires_at = now() + interval '12 hours'
    WHERE session_id = p_guest_session_id AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION '활동 중인 게스트를 찾을 수 없습니다.'; END IF;
  RETURN v_name;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_admin_rename_profile(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_name text;
BEGIN
  IF NOT roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자만 닉네임을 정리할 수 있습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM roomchat_private.member_roles WHERE user_id = p_user_id AND role = 'admin') THEN
    RAISE EXCEPTION '두 관리자 계정의 인증 닉네임은 변경할 수 없습니다.';
  END IF;
  v_name := roomchat_private.allocate_nickname('크리스탈 시청자', NULL, p_user_id);
  UPDATE public.roomchat_profiles SET nickname = v_name, updated_at = now(), is_verified = false WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.'; END IF;
  RETURN v_name;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_admin_delete_message(p_message_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자만 메시지를 삭제할 수 있습니다.'; END IF;
  DELETE FROM public.messages WHERE id = p_message_id;
  RETURN FOUND;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_admin_room_image_paths(p_room_id uuid)
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_paths text[];
BEGIN
  IF NOT roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자만 방을 정리할 수 있습니다.'; END IF;
  SELECT coalesce(array_agg(m.image_path) FILTER (WHERE m.image_path IS NOT NULL), ARRAY[]::text[])
    INTO v_paths FROM public.messages m WHERE m.room_id = p_room_id;
  RETURN v_paths;
END
$function$;

CREATE OR REPLACE FUNCTION public.roomchat_admin_delete_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_featured boolean;
BEGIN
  IF NOT roomchat_private.is_admin() THEN RAISE EXCEPTION '관리자만 방을 삭제할 수 있습니다.'; END IF;
  SELECT is_featured INTO v_featured FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_featured THEN RAISE EXCEPTION '고정된 기본 방은 삭제할 수 없습니다.'; END IF;
  DELETE FROM public.rooms WHERE id = p_room_id;
  RETURN true;
END
$function$;

-- Add and pin the requested default room without disturbing existing rooms or messages.
INSERT INTO public.rooms(name, is_featured)
VALUES ('슬랩배틀 라이벌 입양 피기', true)
ON CONFLICT (name) DO UPDATE SET is_featured = true;

-- Read access remains public; write paths are through the checked RPCs above.
DROP POLICY IF EXISTS "roomchat rooms are readable" ON public.rooms;
CREATE POLICY "roomchat rooms are readable" ON public.rooms FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "roomchat messages are readable" ON public.messages;
CREATE POLICY "roomchat messages are readable" ON public.messages FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.rooms, public.messages TO anon, authenticated;

-- Keep the old anonymous UI writable during rollout, but do not let it forge a
-- pinned room, account identity, or verified badge before the final hardening step.
DROP POLICY IF EXISTS "roomchat anyone can create rooms" ON public.rooms;
CREATE POLICY "roomchat anyone can create rooms" ON public.rooms FOR INSERT TO anon
  WITH CHECK (char_length(name) BETWEEN 2 AND 32 AND created_by IS NULL AND is_featured = false);
DROP POLICY IF EXISTS "roomchat anyone can post messages" ON public.messages;
CREATE POLICY "roomchat anyone can post messages" ON public.messages FOR INSERT TO anon WITH CHECK (
  char_length(nickname) BETWEEN 1 AND 24
  AND (content IS NULL OR char_length(content) <= 2000)
  AND ((content IS NOT NULL AND char_length(btrim(content)) > 0) OR image_path IS NOT NULL)
  AND user_id IS NULL AND guest_session_id IS NULL AND is_verified = false
);

DROP POLICY IF EXISTS "roomchat anonymous image upload" ON storage.objects;
DROP POLICY IF EXISTS "roomchat image upload" ON storage.objects;
CREATE POLICY "roomchat image upload" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'chat-images'
    AND name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{1,128}[.](jpg|png|webp|gif|avif)$'
    AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.id::text = split_part(storage.objects.name, '/', 1))
  );
DROP POLICY IF EXISTS "roomchat administrators can delete images" ON storage.objects;
CREATE POLICY "roomchat administrators can delete images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-images' AND public.roomchat_is_admin());

REVOKE ALL ON FUNCTION public.roomchat_claim_guest_nickname(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_refresh_guest(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_track_member(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_list_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_create_room(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_post_message(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_is_kicked(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_update_my_nickname(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_kick_member(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_admin_rename_guest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_admin_rename_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_admin_delete_message(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_admin_room_image_paths(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roomchat_admin_delete_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roomchat_claim_guest_nickname(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_refresh_guest(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_track_member(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_list_members(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_create_room(text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_post_message(uuid, text, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_is_kicked(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_update_my_nickname(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_kick_member(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_admin_rename_guest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_admin_rename_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_admin_delete_message(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_admin_room_image_paths(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_admin_delete_room(uuid) TO authenticated;
