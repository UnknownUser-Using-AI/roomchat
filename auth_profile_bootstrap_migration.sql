-- Complete profile/role creation after Auth Admin API inserts. Some managed Auth
-- creation paths may return before the auth.users trigger has materialized the
-- roomchat profile, so the Edge Function calls this idempotent service-only RPC.

CREATE OR REPLACE FUNCTION roomchat_private.ensure_managed_auth_profile(p_user_id uuid)
RETURNS TABLE(nickname text, is_verified boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_app_meta jsonb;
  v_user_meta jsonb;
  v_name text;
  v_claim_code text;
  v_expected_invite text;
  v_matched_invite text;
  v_effective text;
  v_profile_nickname text;
  v_profile_verified boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '계정 ID를 확인할 수 없습니다.';
  END IF;

  SELECT u.raw_app_meta_data, u.raw_user_meta_data
    INTO v_app_meta, v_user_meta
    FROM auth.users u
    WHERE u.id = p_user_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '계정을 찾을 수 없습니다.';
  END IF;
  IF coalesce(v_app_meta ->> 'roomchat_managed', 'false') <> 'true' THEN
    RAISE EXCEPTION 'roomchat에서 만든 계정이 아닙니다.';
  END IF;

  SELECT p.nickname, p.is_verified
    INTO v_profile_nickname, v_profile_verified
    FROM public.roomchat_profiles p
    WHERE p.id = p_user_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_profile_nickname, v_profile_verified;
    RETURN;
  END IF;

  v_name := normalize(
    regexp_replace(btrim(coalesce(v_user_meta ->> 'nickname', '')), '[[:space:]]+', ' ', 'g'),
    NFC
  );
  IF char_length(v_name) < 1 OR char_length(v_name) > 24 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '닉네임은 1~24자로 입력해 주세요.';
  END IF;

  IF v_name IN ('천사', '크리스탈', '[인증됨] 천사', '[인증됨] 크리스탈') THEN
    v_claim_code := coalesce(v_user_meta ->> 'admin_claim_code', '');
    v_expected_invite := CASE
      WHEN v_name IN ('천사', '[인증됨] 천사') THEN '[인증됨] 천사'
      ELSE '[인증됨] 크리스탈'
    END;
    v_effective := CASE
      WHEN v_name IN ('천사', '[인증됨] 천사') THEN '천사'
      ELSE '크리스탈'
    END;

    SELECT i.nickname
      INTO v_matched_invite
      FROM roomchat_private.admin_invites i
      WHERE i.nickname = v_expected_invite
        AND i.claimed_by IS NULL
        AND i.code_sha256 = encode(extensions.digest(v_claim_code, 'sha256'), 'hex')
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '이 관리자 계정은 올바른 1회용 초대 링크가 필요합니다.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(lower(v_effective)));
    IF EXISTS (
      SELECT 1 FROM public.roomchat_profiles p
      WHERE p.nickname_key = lower(v_effective)
    ) OR EXISTS (
      SELECT 1 FROM roomchat_private.guest_sessions g
      WHERE g.nickname_key = lower(v_effective) AND g.expires_at > now()
    ) THEN
      v_effective := roomchat_private.allocate_nickname('크리스탈 시청자', NULL, NULL);
    END IF;

    INSERT INTO public.roomchat_profiles(id, nickname, is_verified)
      VALUES (p_user_id, v_effective, true);
    INSERT INTO roomchat_private.member_roles(user_id, role)
      VALUES (p_user_id, 'admin');
    UPDATE roomchat_private.admin_invites AS invite
      SET claimed_by = p_user_id, claimed_at = now()
      WHERE invite.nickname = v_expected_invite AND invite.claimed_by IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION '관리자 초대 링크가 이미 사용되었습니다.';
    END IF;
    UPDATE auth.users
      SET raw_user_meta_data = (
        jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(v_effective), true)
        - 'admin_claim_code'
      )
      WHERE id = p_user_id;
    RETURN QUERY SELECT v_effective, true;
    RETURN;
  END IF;

  IF position('인증됨' IN v_name) > 0 THEN
    RAISE EXCEPTION '인증됨 배지는 지정된 두 관리자 계정에만 표시됩니다.';
  END IF;
  v_effective := roomchat_private.allocate_nickname(v_name, NULL, NULL);
  INSERT INTO public.roomchat_profiles(id, nickname, is_verified)
    VALUES (p_user_id, v_effective, false);
  UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(
      coalesce(raw_user_meta_data, '{}'::jsonb), '{nickname}', to_jsonb(v_effective), true
    )
    WHERE id = p_user_id;
  RETURN QUERY SELECT v_effective, false;
END
$function$;

REVOKE ALL ON FUNCTION roomchat_private.ensure_managed_auth_profile(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.roomchat_materialize_auth_profile(p_user_id uuid)
RETURNS TABLE(nickname text, is_verified boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role only';
  END IF;
  RETURN QUERY
    SELECT * FROM roomchat_private.ensure_managed_auth_profile(p_user_id);
END
$function$;

REVOKE ALL ON FUNCTION public.roomchat_materialize_auth_profile(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roomchat_materialize_auth_profile(uuid) TO service_role;
