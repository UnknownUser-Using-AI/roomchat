-- RoomChat message enhancements
-- Applied to Supabase project losuyalyjcurntylbwgy on 2026-10-21.
-- Keep this file as deployment history; it is safe to review and not intended to be blindly re-run.

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists reply_to bigint;

create table if not exists public.roomchat_message_pins (
  room_id uuid not null,
  message_id bigint not null,
  pinned_by uuid,
  pinned_at timestamptz not null default now(),
  primary key (room_id, message_id)
);

create table if not exists public.roomchat_message_reactions (
  message_id bigint not null,
  user_id uuid not null default auth.uid(),
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists roomchat_message_reactions_message_idx
  on public.roomchat_message_reactions(message_id);
create index if not exists roomchat_message_pins_room_idx
  on public.roomchat_message_pins(room_id, pinned_at desc);

alter table public.roomchat_message_pins enable row level security;
alter table public.roomchat_message_reactions enable row level security;

drop policy if exists roomchat_reactions_read on public.roomchat_message_reactions;
create policy roomchat_reactions_read on public.roomchat_message_reactions
for select to anon, authenticated using (true);

drop policy if exists roomchat_reactions_insert_self on public.roomchat_message_reactions;
create policy roomchat_reactions_insert_self on public.roomchat_message_reactions
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists roomchat_reactions_delete_self on public.roomchat_message_reactions;
create policy roomchat_reactions_delete_self on public.roomchat_message_reactions
for delete to authenticated using (user_id = auth.uid());

drop policy if exists roomchat_pins_read on public.roomchat_message_pins;
create policy roomchat_pins_read on public.roomchat_message_pins
for select to anon, authenticated using (true);

create or replace function public.roomchat_edit_my_message(
  p_message_id bigint,
  p_content text,
  p_guest_session_id uuid default null,
  p_guest_token text default null
) returns public.messages
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.messages%rowtype;
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
begin
  if v_content is null then raise exception '메시지 내용을 입력해 주세요.'; end if;
  if char_length(v_content) > 2000 then raise exception '메시지는 2000자 이내로 입력해 주세요.'; end if;
  if auth.uid() is not null then
    update public.messages set content = v_content, edited_at = now()
      where id = p_message_id and user_id = auth.uid()
      returning * into v_row;
  else
    if p_guest_session_id is null or not exists (
      select 1 from roomchat_private.guest_sessions g
      where g.session_id = p_guest_session_id
        and g.token_sha256 = encode(extensions.digest(coalesce(p_guest_token, ''), 'sha256'), 'hex')
        and g.expires_at > now()
    ) then raise exception '게스트 세션이 만료되었습니다.'; end if;
    update public.messages set content = v_content, edited_at = now()
      where id = p_message_id and user_id is null and guest_session_id = p_guest_session_id
      returning * into v_row;
  end if;
  if not found then raise exception '내가 보낸 메시지만 수정할 수 있어요.'; end if;
  return v_row;
end
$function$;

revoke all on function public.roomchat_edit_my_message(bigint,text,uuid,text) from public;
grant execute on function public.roomchat_edit_my_message(bigint,text,uuid,text) to anon, authenticated;

comment on table public.roomchat_message_pins is 'Pinned messages in RoomChat rooms; writes must be performed through a permission-checked RPC.';
comment on table public.roomchat_message_reactions is 'Emoji reactions for RoomChat messages; users can remove only their own reactions.';
