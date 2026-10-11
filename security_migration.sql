-- Apply only after the new frontend and roomchat-auth Edge Function are live.
-- Browser writes flow through security-definer RPCs, which bind identities and enforce
-- room-owner, administrator, nickname, and kick rules. Keep direct table access read-only.

DROP POLICY IF EXISTS "roomchat anyone can create rooms" ON public.rooms;
DROP POLICY IF EXISTS "roomchat anyone can post messages" ON public.messages;

REVOKE ALL PRIVILEGES ON TABLE public.rooms FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rooms, public.messages TO anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.messages_id_seq FROM PUBLIC, anon, authenticated;
