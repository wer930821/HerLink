
-- Security hardening and legacy cleanup for anonymous-chat-only HerLink.

-- 1) Fix mutable search_path warnings.
alter function public.check_profile_write() set search_path = public, pg_temp;
alter function public.random_pair_key(uuid, uuid) set search_path = public, pg_temp;

-- 2) Trigger helpers must never be callable directly from the public API.
revoke execute on function public.check_profile_write() from public, anon, authenticated;
revoke execute on function public.enforce_anonymous_display_name() from public, anon, authenticated;
revoke execute on function public.emit_random_session_alias_signal() from public, anon, authenticated;
revoke execute on function public.emit_random_chat_signal() from public, anon, authenticated;
grant execute on function public.check_profile_write() to service_role;
grant execute on function public.enforce_anonymous_display_name() to service_role;
grant execute on function public.emit_random_session_alias_signal() to service_role;
grant execute on function public.emit_random_chat_signal() to service_role;

-- 3) Risk mutation is internal-only. Client-facing safety RPCs invoke it under
-- their SECURITY DEFINER owner when needed.
revoke execute on function public.apply_risk_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_risk_event(uuid, text, jsonb) to service_role;

-- 4) Legacy icebreaker RPCs remain available to authenticated old app builds,
-- but unauthenticated callers can no longer invoke them.
revoke execute on function public.advance_random_chat_icebreaker(uuid) from public, anon;
revoke execute on function public.get_random_session_icebreaker(uuid) from public, anon;
revoke execute on function public.get_random_session_icebreaker_analytics(uuid) from public, anon;
revoke execute on function public.icebreaker_question_for_turn(uuid, integer) from public, anon;
grant execute on function public.advance_random_chat_icebreaker(uuid) to authenticated, service_role;
grant execute on function public.get_random_session_icebreaker(uuid) to authenticated, service_role;
grant execute on function public.get_random_session_icebreaker_analytics(uuid) to authenticated, service_role;
grant execute on function public.icebreaker_question_for_turn(uuid, integer) to authenticated, service_role;

-- 5) Legacy verification submission also requires an authenticated session.
revoke execute on function public.create_verification_submission(text, text) from public, anon;
grant execute on function public.create_verification_submission(text, text) to authenticated, service_role;

-- 6) Web and current native clients do not consume random_chat_signals.
-- Stop the redundant write amplification while keeping the table/functions
-- in place temporarily for rollback compatibility.
drop trigger if exists profiles_emit_random_session_alias_signal on public.profiles;
drop trigger if exists random_chat_message_signal on public.random_chat_messages;
drop trigger if exists random_chat_session_signal on public.random_chat_sessions;
