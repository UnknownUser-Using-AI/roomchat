-- Roomchat supports a single nesting level: top-level channels and their child rooms.
-- Child rooms cannot themselves contain rooms. Apply after the room image / owner RPC migrations.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL REFERENCES public.rooms(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS rooms_parent_created_idx
  ON public.rooms(parent_id, created_at);

DROP FUNCTION IF EXISTS public.roomchat_create_room(text, uuid, text, text);

CREATE FUNCTION public.roomchat_create_room(
  p_name text,
  p_guest_session_id uuid,
  p_guest_token text,
  p_owner_token text,
  p_parent_room_id uuid DEFAULT NULL
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF p_parent_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rooms parent
    WHERE parent.id = p_parent_room_id AND parent.parent_id IS NULL
  ) THEN
    RAISE EXCEPTION '하위 방은 상위 채널 안에서만 만들 수 있어요. 하위 방 안에 또 다른 방은 만들 수 없습니다.';
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

  INSERT INTO public.rooms(name, created_by, is_featured, parent_id)
    VALUES (v_name, auth.uid(), false, p_parent_room_id)
    RETURNING * INTO v_room;

  IF auth.uid() IS NULL THEN
    INSERT INTO roomchat_private.room_owners(room_id, owner_session_id, owner_token_sha256)
      VALUES (v_room.id, p_guest_session_id, encode(extensions.digest(p_owner_token, 'sha256'), 'hex'));
  END IF;
  RETURN v_room;
END
$function$;

REVOKE ALL ON FUNCTION public.roomchat_create_room(text, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roomchat_create_room(text, uuid, text, text, uuid) TO anon, authenticated;
