-- Allow only site admins to pin/unpin messages, validating the room/message pair server-side.
create or replace function public.roomchat_admin_set_message_pin(
  p_room_id uuid,
  p_message_id bigint,
  p_pin boolean
) returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.roomchat_is_admin() then
    raise exception '관리자만 메시지를 고정할 수 있어요.';
  end if;
  if not exists (
    select 1 from public.messages m
    where m.id = p_message_id and m.room_id = p_room_id
  ) then
    raise exception '해당 방에서 메시지를 찾을 수 없습니다.';
  end if;
  if coalesce(p_pin, false) then
    insert into public.roomchat_message_pins(room_id, message_id, pinned_by, pinned_at)
      values (p_room_id, p_message_id, auth.uid(), now())
      on conflict (room_id, message_id) do update
        set pinned_by = excluded.pinned_by, pinned_at = excluded.pinned_at;
  else
    delete from public.roomchat_message_pins
      where room_id = p_room_id and message_id = p_message_id;
  end if;
  return coalesce(p_pin, false);
end
$function$;
revoke all on function public.roomchat_admin_set_message_pin(uuid,bigint,boolean) from public;
grant execute on function public.roomchat_admin_set_message_pin(uuid,bigint,boolean) to anon, authenticated;
