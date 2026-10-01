
create or replace function public.get_admin_health_metrics()
returns table(
  today_match_success_rate numeric,
  today_avg_wait_seconds numeric,
  realtime_errors_1h bigint,
  today_push_success_rate numeric,
  today_laya_success_rate numeric,
  today_chat_assist_requests bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  today_start timestamptz :=
    ((timezone('Asia/Taipei', now()))::date::timestamp at time zone 'Asia/Taipei');
begin
  if auth.role() <> 'service_role' and (
    actor_id is null or not exists (
      select 1
      from public.admin_users
      where user_id = actor_id
        and role = 'admin'
        and active = true
    )
  ) then
    raise exception 'Admin access required.';
  end if;

  return query
  with queue_stats as (
    select
      count(*) filter (where status = 'matched')::numeric as matched_count,
      count(*) filter (where status in ('matched','left'))::numeric as completed_count,
      avg(extract(epoch from (updated_at - joined_at)))
        filter (where status = 'matched' and updated_at >= joined_at) as avg_wait_seconds
    from public.random_match_queue
    where joined_at >= today_start
  ),
  realtime_stats as (
    select count(distinct client_instance_id)::bigint as error_count
    from public.realtime_diagnostics
    where created_at >= now() - interval '1 hour'
      and event_type = 'realtime_subscribe_error'
  ),
  push_stats as (
    select
      count(*) filter (where status = 'sent')::numeric as sent_count,
      count(*)::numeric as total_count
    from public.web_push_deliveries
    where created_at >= today_start
  ),
  laya_stats as (
    select
      count(*) filter (where engine = 'laya')::numeric as laya_count,
      count(*)::numeric as total_count
    from public.chat_assist_health_events
    where created_at >= today_start
  )
  select
    case when q.completed_count > 0
      then round((q.matched_count / q.completed_count) * 100, 1)
      else null end,
    case when q.avg_wait_seconds is not null
      then round(q.avg_wait_seconds::numeric, 1)
      else null end,
    r.error_count,
    case when p.total_count > 0
      then round((p.sent_count / p.total_count) * 100, 1)
      else null end,
    case when l.total_count > 0
      then round((l.laya_count / l.total_count) * 100, 1)
      else null end,
    l.total_count::bigint
  from queue_stats q, realtime_stats r, push_stats p, laya_stats l;
end;
$$;

revoke execute on function public.get_admin_health_metrics() from public, anon;
grant execute on function public.get_admin_health_metrics() to authenticated, service_role;
