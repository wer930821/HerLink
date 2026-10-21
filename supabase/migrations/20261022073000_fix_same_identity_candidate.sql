begin;

create or replace function public.station_mail_admin_identity_candidates(p_thread_id uuid)
returns table(identity_id uuid, anonymous_display_name text, source text, chat_count bigint, message_count bigint, contact_count bigint, confidence text)
language plpgsql stable security definer set search_path='public'
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid() and au.active=true) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.station_mail_threads t where t.id=p_thread_id and t.deleted_at is null) then raise exception 'MAIL_THREAD_NOT_FOUND'; end if;

  return query
  with thread_user(sender_id) as (
    select t.user_id from public.station_mail_threads t where t.id=p_thread_id
  ),
  candidates(candidate_identity_id, candidate_source, candidate_ordinal) as (
    select tu.sender_id, '寄件者目前匿名身分'::text, 0 from thread_user tu
    union all
    select h.anonymous_identity_id, '帳號綁定歷史'::text, 1
      from public.anonymous_identity_binding_history h join thread_user tu on tu.sender_id=h.active_auth_user_id
      where h.anonymous_identity_id<>tu.sender_id
    union all
    select s.anonymous_identity_id, '裝置綁定紀錄'::text, 3
      from public.anonymous_identity_device_state s join thread_user tu on tu.sender_id=s.active_auth_user_id
      where s.anonymous_identity_id<>tu.sender_id
    union all
    select c.anonymous_identity_id, '恢復碼歷史'::text, 4
      from public.anonymous_recovery_credentials c
      join public.anonymous_identity_binding_history h on h.anonymous_identity_id=c.anonymous_identity_id
      join thread_user tu on tu.sender_id=h.active_auth_user_id
      where c.anonymous_identity_id<>tu.sender_id
    union all
    select a.requester_id, '恢復嘗試紀錄'::text, 5
      from public.anonymous_recovery_attempts a join thread_user tu on tu.sender_id=a.requester_id
      where a.requester_id<>tu.sender_id
  ),
  unique_candidates(candidate_identity_id, candidate_source, candidate_ordinal) as (
    select distinct on (c.candidate_identity_id)
      c.candidate_identity_id, c.candidate_source, c.candidate_ordinal
    from candidates c
    order by c.candidate_identity_id, c.candidate_ordinal, c.candidate_source
  )
  select u.candidate_identity_id, p.anonymous_display_name, u.candidate_source,
    (select count(*) from public.random_chat_sessions s where s.user_a=u.candidate_identity_id or s.user_b=u.candidate_identity_id),
    (select count(*) from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=u.candidate_identity_id or s.user_b=u.candidate_identity_id),
    (select count(*) from public.anonymous_contacts ac where ac.user_a=u.candidate_identity_id or ac.user_b=u.candidate_identity_id),
    case when u.candidate_ordinal<=1 then '高' when u.candidate_ordinal<=3 then '中' else '低' end
  from unique_candidates u
  join public.profiles p on p.id=u.candidate_identity_id and p.anonymous_mode_enabled=true
  order by u.candidate_ordinal, p.created_at desc;
end;
$$;

revoke all on function public.station_mail_admin_identity_candidates(uuid) from public,anon;
grant execute on function public.station_mail_admin_identity_candidates(uuid) to authenticated;

commit;
