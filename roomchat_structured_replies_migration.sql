-- Structured replies: server-side validation ensures the original belongs to the same room.
create or replace function public.roomchat_post_reply(
  p_room_id uuid,
  p_content text default null,
  p_image_path text default null,
  p_guest_session_id uuid default null,
  p_guest_token text default null,
  p_reply_to bigint default null
) returns public.messages
language plpgsql security definer set search_path to ''
as $function$
declare
  v_nickname text;
  v_user_id uuid := auth.uid();
  v_row public.messages%rowtype;
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_is_guide boolean := false;
begin
  select coalesce(r.is_featured and r.name = '설명 방', false) into v_is_guide
    from public.rooms r where r.id = p_room_id;
  if not found then raise exception '이 방은 더 이상 존재하지 않습니다.'; end if;
  if v_is_guide then raise exception '설명 방에서는 채팅할 수 없어요.'; end if;
  if v_content is not null and char_length(v_content) > 2000 then raise exception '메시지는 2000자 이내로 입력해 주세요.'; end if;
  if v_content is null and p_image_path is null then raise exception '메시지나 이미지를 입력해 주세요.'; end if;
  if p_image_path is not null and p_image_path not like p_room_id::text || '/%' then raise exception '이미지 경로가 현재 방과 일치하지 않습니다.'; end if;
  if p_reply_to is not null and not exists (select 1 from public.messages m where m.id = p_reply_to and m.room_id = p_room_id) then
    raise exception '답글을 달 원본 메시지를 찾을 수 없습니다.';
  end if;
  if v_user_id is not null then
    select nickname into v_nickname from public.roomchat_profiles where id = v_user_id;
    if v_nickname is null then raise exception '계정 닉네임을 확인할 수 없습니다.'; end if;
    if roomchat_private.is_kicked_now(p_room_id, v_user_id, null) then raise exception '이 방의 운영자가 참여를 제한했습니다.'; end if;
  else
    select nickname into v_nickname from roomchat_private.guest_sessions
      where session_id = p_guest_session_id
        and token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        and expires_at > now();
    if v_nickname is null then raise exception '게스트 이름을 먼저 정해 주세요.'; end if;
    if roomchat_private.is_kicked_now(p_room_id, null, p_guest_session_id) then raise exception '이 방의 운영자가 참여를 제한했습니다.'; end if;
  end if;
  insert into public.messages(room_id, nickname, content, image_path, user_id, guest_session_id, is_verified, reply_to)
    values (p_room_id, v_nickname, v_content, p_image_path, v_user_id,
      case when v_user_id is null then p_guest_session_id else null end,
      roomchat_private.is_admin(), p_reply_to)
    returning * into v_row;
  return v_row;
end
$function$;
revoke all on function public.roomchat_post_reply(uuid,text,text,uuid,text,bigint) from public;
grant execute on function public.roomchat_post_reply(uuid,text,text,uuid,text,bigint) to anon, authenticated;
