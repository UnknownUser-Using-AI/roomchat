-- DM 읽음 확인: 수신자가 대화를 열어 메시지를 확인하면 발신자에게 읽음 상태를 보여 줍니다.
ALTER TABLE public.roomchat_dms
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE OR REPLACE FUNCTION public.roomchat_mark_dms_read(p_sender uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION '계정 로그인이 필요합니다.';
  END IF;
  IF p_sender IS NULL OR p_sender = v_me THEN
    RAISE EXCEPTION '올바른 대화 상대를 지정해 주세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.roomchat_friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester = v_me AND f.addressee = p_sender)
        OR (f.requester = p_sender AND f.addressee = v_me))
  ) THEN
    RAISE EXCEPTION '친구끼리만 DM을 확인할 수 있어요.';
  END IF;
  UPDATE public.roomchat_dms
    SET read_at = now()
    WHERE sender = p_sender
      AND recipient = v_me
      AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION public.roomchat_mark_dms_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roomchat_mark_dms_read(uuid) TO authenticated;
