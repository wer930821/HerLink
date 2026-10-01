
-- HerLink anonymous users sign in through Supabase Auth and therefore use the
-- authenticated database role. Keep anon access only for the public online
-- counter used before sign-in.

revoke execute on function public.assert_rate_limit(text, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.check_random_action_rate_limit(text, integer, interval, jsonb) from public, anon, authenticated;
revoke execute on function public.has_block_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_profile_eligible(uuid) from public, anon, authenticated;
revoke execute on function public.is_random_session_member(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.log_anonymous_block_risk() from public, anon, authenticated;
revoke execute on function public.log_anonymous_fraud_risk() from public, anon, authenticated;
revoke execute on function public.log_anonymous_report_risk() from public, anon, authenticated;
revoke execute on function public.record_anonymous_risk_event_by_user_id(uuid, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.refresh_anonymous_abuse_status_by_key(text) from public, anon, authenticated;
revoke execute on function public.reconcile_profile_enforcement_status(uuid) from public, anon, authenticated;

grant execute on function public.assert_rate_limit(text, integer, integer, jsonb) to service_role;
grant execute on function public.check_random_action_rate_limit(text, integer, interval, jsonb) to service_role;
grant execute on function public.has_block_between(uuid, uuid) to service_role;
grant execute on function public.is_profile_eligible(uuid) to service_role;
grant execute on function public.is_random_session_member(uuid, uuid, text) to service_role;
grant execute on function public.log_anonymous_block_risk() to service_role;
grant execute on function public.log_anonymous_fraud_risk() to service_role;
grant execute on function public.log_anonymous_report_risk() to service_role;
grant execute on function public.record_anonymous_risk_event_by_user_id(uuid, text, jsonb, uuid, uuid, uuid) to service_role;
grant execute on function public.refresh_anonymous_abuse_status_by_key(text) to service_role;
grant execute on function public.reconcile_profile_enforcement_status(uuid) to service_role;

-- User-facing RPCs require a signed-in Supabase user. Anonymous sign-in users
-- are authenticated-role users, so unauthenticated anon role is not needed.
revoke execute on function public.block_random_user(uuid) from public, anon;
revoke execute on function public.create_or_update_push_token(text, text, text) from public, anon;
revoke execute on function public.disable_push_token(text) from public, anon;
revoke execute on function public.enqueue_self_push_test_notification() from public, anon;
revoke execute on function public.find_or_join_random_match() from public, anon;
revoke execute on function public.get_my_latest_random_session_diagnostic() from public, anon;
revoke execute on function public.get_my_random_session_view(uuid) from public, anon;
revoke execute on function public.get_random_message_reply_preview(uuid, uuid) from public, anon;
revoke execute on function public.get_safe_anonymous_profiles(uuid[]) from public, anon;
revoke execute on function public.is_anonymous_matchmaking_allowed(uuid) from public, anon;
revoke execute on function public.leave_random_queue() from public, anon;
revoke execute on function public.leave_random_session(uuid) from public, anon;
revoke execute on function public.list_my_blocked_users() from public, anon;
revoke execute on function public.list_random_messages(uuid, integer, timestamptz, uuid, timestamptz, uuid) from public, anon;
revoke execute on function public.next_random_match(uuid) from public, anon;
revoke execute on function public.record_realtime_diagnostic(uuid, text, text, uuid, text, jsonb) from public, anon;
revoke execute on function public.register_anonymous_abuse_identity(text) from public, anon;
revoke execute on function public.register_device(text) from public, anon;
revoke execute on function public.register_web_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.report_random_user(uuid, text, text, boolean) from public, anon;
revoke execute on function public.request_account_deletion() from public, anon;
revoke execute on function public.revoke_web_push_subscription(uuid) from public, anon;
revoke execute on function public.revoke_web_push_subscription_by_endpoint(text) from public, anon;
revoke execute on function public.send_random_message(uuid, text, text, text, text, bigint, integer, integer, uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;

grant execute on function public.block_random_user(uuid) to authenticated, service_role;
grant execute on function public.create_or_update_push_token(text, text, text) to authenticated, service_role;
grant execute on function public.disable_push_token(text) to authenticated, service_role;
grant execute on function public.enqueue_self_push_test_notification() to authenticated, service_role;
grant execute on function public.find_or_join_random_match() to authenticated, service_role;
grant execute on function public.get_my_latest_random_session_diagnostic() to authenticated, service_role;
grant execute on function public.get_my_random_session_view(uuid) to authenticated, service_role;
grant execute on function public.get_random_message_reply_preview(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_safe_anonymous_profiles(uuid[]) to authenticated, service_role;
grant execute on function public.is_anonymous_matchmaking_allowed(uuid) to authenticated, service_role;
grant execute on function public.leave_random_queue() to authenticated, service_role;
grant execute on function public.leave_random_session(uuid) to authenticated, service_role;
grant execute on function public.list_my_blocked_users() to authenticated, service_role;
grant execute on function public.list_random_messages(uuid, integer, timestamptz, uuid, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.next_random_match(uuid) to authenticated, service_role;
grant execute on function public.record_realtime_diagnostic(uuid, text, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.register_anonymous_abuse_identity(text) to authenticated, service_role;
grant execute on function public.register_device(text) to authenticated, service_role;
grant execute on function public.register_web_push_subscription(text, text, text, text) to authenticated, service_role;
grant execute on function public.report_random_user(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.request_account_deletion() to authenticated, service_role;
grant execute on function public.revoke_web_push_subscription(uuid) to authenticated, service_role;
grant execute on function public.revoke_web_push_subscription_by_endpoint(text) to authenticated, service_role;
grant execute on function public.send_random_message(uuid, text, text, text, text, bigint, integer, integer, uuid) to authenticated, service_role;
grant execute on function public.unblock_user(uuid) to authenticated, service_role;

-- Intentionally public before sign-in:
grant execute on function public.get_online_user_count() to anon, authenticated, service_role;
