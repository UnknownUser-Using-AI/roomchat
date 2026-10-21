-- Keep at most the newest 30 chat messages per room.
-- Run this migration in the Supabase SQL Editor.
CREATE OR REPLACE FUNCTION public.roomchat_keep_latest_30_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM public.messages AS m
  WHERE m.room_id = NEW.room_id
    AND m.id IN (
      SELECT older.id
      FROM public.messages AS older
      WHERE older.room_id = NEW.room_id
      ORDER BY older.created_at DESC, older.id DESC
      OFFSET 30
    );
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS roomchat_limit_messages_per_room ON public.messages;
CREATE TRIGGER roomchat_limit_messages_per_room
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.roomchat_keep_latest_30_messages();
