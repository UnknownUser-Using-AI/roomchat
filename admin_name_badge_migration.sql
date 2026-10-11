-- Separate the verified-admin badge from a mutable display nickname.
-- Existing invite rows keep their original one-time code hashes.

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
  v_admin_name_change boolean := false;
BEGIN
  IF p_exclude_user_id IS NOT NULL AND v_requested IN ('천사', '크리스탈') THEN
    SELECT EXISTS (
      SELECT 1 FROM roomchat_private.member_roles r
      WHERE r.user_id = p_exclude_user_id AND r.role = 'admin'
    ) INTO v_admin_name_change;
  END IF;

  IF position('인증됨' IN v_requested) > 0
     OR (v_requested IN ('천사', '크리스탈') AND NOT v_admin_name_change)
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
  v_invite_name text;
  v_effective text;
BEGIN
  IF coalesce(new.raw_app_meta_data ->> 'roomchat_managed', 'false') <> 'true' THEN
    RETURN new;
  END IF;

  v_name := normalize(regexp_replace(btrim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '[[:space:]]+', ' ', 'g'), NFC);
  IF char_length(v_name) < 1 OR char_length(v_name) > 24 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '닉네임은 1~24자로 입력해 주세요.';
  END IF;

  IF v_name IN ('천사', '크리스탈', '[인증됨] 천사', '[인증됨] 크리스탈') THEN
    v_claim_code := coalesce(new.raw_user_meta_data ->> 'admin_claim_code', '');
    v_invite_name := CASE
      WHEN v_name IN ('천사', '[인증됨] 천사') THEN '[인증됨] 천사'
      ELSE '[인증됨] 크리스탈'
    END;
    v_effective := CASE
      WHEN v_name IN ('천사', '[인증됨] 천사') THEN '천사'
      ELSE '크리스탈'
    END;
    SELECT * INTO v_invite
    FROM roomchat_private.admin_invites i
    WHERE i.nickname = v_invite_name AND i.claimed_by IS NULL
      AND i.code_sha256 = encode(extensions.digest(v_claim_code, 'sha256'), 'hex')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '이 관리자 계정은 올바른 1회용 초대 코드가 필요합니다.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(lower(v_effective)));
    IF EXISTS (SELECT 1 FROM public.roomchat_profiles p WHERE p.nickname_key = lower(v_effective))
       OR EXISTS (SELECT 1 FROM roomchat_private.guest_sessions g WHERE g.nickname_key = lower(v_effective) AND g.expires_at > now()) THEN
      v_effective := roomchat_private.allocate_nickname('크리스탈 시청자', NULL, NULL);
    END IF;

    INSERT INTO public.roomchat_profiles(id, nickname, is_verified)
    VALUES (new.id, v_effective, true);
    INSERT INTO roomchat_private.member_roles(user_id, role) VALUES (new.id, 'admin');
    UPDATE roomchat_private.admin_invites
      SET claimed_by = new.id, claimed_at = now()
      WHERE nickname = v_invite_name;
    UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(v_effective), true) - 'admin_claim_code'
      WHERE id = new.id;
  ELSE
    IF position('인증됨' IN v_name) > 0 THEN
      RAISE EXCEPTION '인증됨 배지는 지정된 두 관리자 계정에만 표시됩니다.';
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

CREATE OR REPLACE FUNCTION public.roomchat_update_my_nickname(p_requested text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '계정 로그인이 필요합니다.'; END IF;
  v_name := roomchat_private.allocate_nickname(p_requested, NULL, auth.uid());
  UPDATE public.roomchat_profiles SET nickname = v_name, updated_at = now() WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '계정 프로필을 찾을 수 없습니다.'; END IF;
  UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(v_name), true)
    WHERE id = auth.uid();
  RETURN v_name;
END
$function$;

-- Normalize any admin profiles created with the old tagged nickname, while preserving verification.
WITH renamed AS (
  UPDATE public.roomchat_profiles p
  SET nickname = roomchat_private.allocate_nickname(
        CASE p.nickname
          WHEN '[인증됨] 천사' THEN '천사'
          WHEN '[인증됨] 크리스탈' THEN '크리스탈'
        END, NULL, p.id
      ),
      updated_at = now()
  FROM roomchat_private.member_roles r
  WHERE r.user_id = p.id
    AND r.role = 'admin'
    AND p.nickname IN ('[인증됨] 천사', '[인증됨] 크리스탈')
  RETURNING p.id, p.nickname
)
UPDATE auth.users u
SET raw_user_meta_data = jsonb_set(coalesce(u.raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(renamed.nickname), true)
FROM renamed
WHERE u.id = renamed.id;
