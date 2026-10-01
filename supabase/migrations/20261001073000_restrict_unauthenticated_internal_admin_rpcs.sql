-- Remove unauthenticated access from administration/internal helper RPCs.
-- Authenticated access is intentionally preserved in this step to avoid
-- changing existing admin/client behavior while reducing public attack surface.

revoke execute on function public.internal_open_or_update_case(uuid, text, text, text, uuid, text, jsonb) from public, anon;
revoke execute on function public.internal_set_profile_account_status(uuid, text) from public, anon;
revoke execute on function public.internal_sync_identity_case(uuid, uuid) from public, anon;
revoke execute on function public.internal_write_moderation_log(uuid, uuid, uuid, text, text, jsonb) from public, anon;

revoke execute on function public.moderate_account(uuid, text, text) from public, anon;
revoke execute on function public.review_moderation_case(uuid, text, text) from public, anon;
revoke execute on function public.review_report(uuid, text, text) from public, anon;
revoke execute on function public.review_verification(uuid, text, text) from public, anon;
revoke execute on function public.take_moderation_case(uuid) from public, anon;
revoke execute on function public.flag_photo_under_review(uuid, text) from public, anon;

revoke execute on function public.is_active_admin(text[]) from public, anon;
revoke execute on function public.require_active_admin(text[]) from public, anon;

revoke execute on function public.enqueue_push_notification(text, text, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, uuid, text) from public, anon;
revoke execute on function public.handle_random_match_push_notification() from public, anon;
revoke execute on function public.handle_random_message_push_notification() from public, anon;
revoke execute on function public.handle_verification_push_notification() from public, anon;
revoke execute on function public.run_verification_media_cleanup_job() from public, anon;
