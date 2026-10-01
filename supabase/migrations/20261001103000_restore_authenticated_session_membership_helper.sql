
-- Restore authenticated execution for the helper used by authenticated RLS
-- policies (notably chat-media Storage). Keep unauthenticated anon blocked.
revoke execute on function public.is_random_session_member(uuid, uuid, text) from public, anon;
grant execute on function public.is_random_session_member(uuid, uuid, text) to authenticated, service_role;
