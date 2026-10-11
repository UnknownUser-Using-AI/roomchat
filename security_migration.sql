-- Apply only after the new frontend and roomchat-auth Edge Function are live.
-- Writes then flow through the security-definer RPCs, which bind identities and enforce
-- room-owner, administrator, nickname, and kick rules.

DROP POLICY IF EXISTS "roomchat anyone can create rooms" ON public.rooms;
DROP POLICY IF EXISTS "roomchat anyone can post messages" ON public.messages;

REVOKE INSERT, UPDATE, DELETE ON public.rooms FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rooms, public.messages TO anon, authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.messages_id_seq FROM PUBLIC, anon, authenticated;
