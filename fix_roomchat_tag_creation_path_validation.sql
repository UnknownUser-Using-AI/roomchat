-- Fix tag creation: the previous regular expression escaped the dot twice,
-- rejecting valid image paths such as <uuid>/<uuid>.webp.
create or replace function public.roomchat_create_tag(p_name text, p_image_path text)
returns public.roomchat_tags
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := normalize(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'), NFC);
  v_row public.roomchat_tags%rowtype;
begin
  if v_uid is null then raise exception '계정 로그인이 필요합니다.'; end if;
  if not exists (select 1 from public.roomchat_profiles where id = v_uid) then
    raise exception '계정 프로필을 찾을 수 없습니다.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 12 or v_name ~ '[[:cntrl:]]' then
    raise exception '태그 이름은 1~12자로 입력해 주세요.';
  end if;
  if position('인증됨' in v_name) > 0 then raise exception '인증됨 이름은 태그로 만들 수 없어요.'; end if;
  if roomchat_private.is_weird_nickname(v_name) then raise exception '사용할 수 없는 태그 이름이에요.'; end if;
  if (select count(*) from public.roomchat_tags t where t.created_by = v_uid) >= 10 then
    raise exception '태그는 계정당 10개까지 만들 수 있어요.';
  end if;
  if p_image_path is null
     or p_image_path !~ $regex$^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$regex$
     or split_part(p_image_path, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'tags' and o.name = p_image_path) then
    raise exception '태그 이미지를 확인할 수 없습니다.';
  end if;
  begin
    insert into public.roomchat_tags(name, image_path, created_by)
    values (v_name, p_image_path, v_uid) returning * into v_row;
  exception when unique_violation then
    raise exception '같은 이름의 태그가 이미 있어요. 목록에서 골라 쓸 수 있어요.';
  end;
  return v_row;
end
$function$;
revoke all on function public.roomchat_create_tag(text,text) from public;
grant execute on function public.roomchat_create_tag(text,text) to authenticated;
