-- Reduce the public API surface for admin-only procedures and trigger functions.
-- Trigger invocation is unaffected by revoking direct RPC EXECUTE permissions.
revoke execute on function public.roomchat_keep_latest_30_messages() from public, anon, authenticated;
revoke execute on function public.roomchat_queue_deleted_message_image() from public, anon, authenticated;
revoke execute on function public.roomchat_set_admin_room_unlimited() from public, anon, authenticated;

-- These operations are only intended for a logged-in, verified RoomChat administrator.
-- Their bodies check the administrator role as well; this is defense in depth.
revoke execute on function public.roomchat_admin_delete_message(bigint) from anon;
revoke execute on function public.roomchat_admin_delete_room(uuid) from anon;
revoke execute on function public.roomchat_admin_rename_guest(uuid) from anon;
revoke execute on function public.roomchat_admin_rename_profile(uuid) from anon;
revoke execute on function public.roomchat_admin_room_image_paths(uuid) from anon;
revoke execute on function public.roomchat_admin_set_message_pin(uuid, bigint, boolean) from anon;
