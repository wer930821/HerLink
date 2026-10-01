-- Restrict backend maintenance and delivery RPCs to service_role.
-- These functions are not part of the anonymous chat client API.

revoke execute on function public.claim_push_notification_events(uuid, integer, boolean) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_verification_media(timestamptz) from public, anon, authenticated;
revoke execute on function public.configure_verification_media_cleanup_schedule(text, text, text) from public, anon, authenticated;
revoke execute on function public.configure_web_push_delivery_schedule(text, text, text) from public, anon, authenticated;
revoke execute on function public.dispatch_random_push_event_immediately() from public, anon, authenticated;
revoke execute on function public.expire_stale_random_web_push_backlog(interval, interval) from public, anon, authenticated;

grant execute on function public.claim_push_notification_events(uuid, integer, boolean) to service_role;
grant execute on function public.cleanup_expired_verification_media(timestamptz) to service_role;
grant execute on function public.configure_verification_media_cleanup_schedule(text, text, text) to service_role;
grant execute on function public.configure_web_push_delivery_schedule(text, text, text) to service_role;
grant execute on function public.dispatch_random_push_event_immediately() to service_role;
grant execute on function public.expire_stale_random_web_push_backlog(interval, interval) to service_role;
