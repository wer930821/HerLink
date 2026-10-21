begin;

create or replace function public.station_mail_admin_identity_candidates(p_thread_id uuid)
returns table(identity_id uuid, anonymous_display_name text, source text, chat_count bigint, message_count bigint, contact_count bigint, confidence text)
language plpgsql stable security definer set search_path='public'
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.station_mail_threads where id=p_thread_id and deleted_at is null) then raise exception 'MAIL_THREAD_NOT_FOUND'; end if;
  return query
  with thread_user as (select user_id from public.station_mail_threads where id=p_thread_id), candidates as (
    select tu.user_id identity_id, '目前登入匿名身分'::text source, 1 rank from thread_user tu
    union select s.anonymous_identity_id, '裝置綁定紀錄', 2 from public.anonymous_identity_device_state s join thread_user tu on tu.user_id=s.active_auth_user_id
    union select c.anonymous_identity_id, '恢復碼歷史', 3 from public.anonymous_recovery_credentials c join public.anonymous_identity_device_state s on s.anonymous_identity_id=c.anonymous_identity_id join thread_user tu on tu.user_id=s.active_auth_user_id
    union select a.requester_id, '恢復嘗試紀錄', 4 from public.anonymous_recovery_attempts a join thread_user tu on tu.user_id=a.requester_id
  ), unique_candidates as (select identity_id, min(source) source, min(rank) rank from candidates group by identity_id)
  select u.identity_id, p.anonymous_display_name, u.source,
    (select count(*) from public.random_chat_sessions s where s.user_a=u.identity_id or s.user_b=u.identity_id),
    (select count(*) from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=u.identity_id or s.user_b=u.identity_id),
    (select count(*) from public.anonymous_contacts c where c.user_a=u.identity_id or c.user_b=u.identity_id),
    case when u.rank=1 then '高' when u.rank=2 then '中' else '低' end
  from unique_candidates u join public.profiles p on p.id=u.identity_id and p.anonymous_mode_enabled=true
  order by u.rank, p.updated_at desc nulls last;
end;
$$;

revoke all on function public.station_mail_admin_identity_candidates(uuid) from public, anon;
grant execute on function public.station_mail_admin_identity_candidates(uuid) to authenticated;
commit;
