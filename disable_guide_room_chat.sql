-- 설명 방은 안내 전용으로 만들고, 일반 채팅 / 이미지 / GIF 전송을 서버에서도 차단합니다.
-- Supabase SQL Editor에서 실행할 수 있으며, 재실행해도 안전합니다.

CREATE OR REPLACE FUNCTION public.roomchat_post_message(
  p_room_id uuid,
  p_content text DEFAULT NULL,
  p_image_path text DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL,
  p_guest_token text DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_nickname text;
  v_user_id uuid := auth.uid();
  v_row public.messages%ROWTYPE;
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_is_guide boolean := false;
BEGIN
  SELECT coalesce(r.is_featured AND r.name = '설명 방', false)
    INTO v_is_guide
    FROM public.rooms r
    WHERE r.id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '이 방은 더 이상 존재하지 않습니다.';
  END IF;
  IF v_is_guide THEN
    RAISE EXCEPTION '설명 방에서는 채팅할 수 없어요.';
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
