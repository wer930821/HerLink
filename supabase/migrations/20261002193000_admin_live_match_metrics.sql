create or replace function public.get_admin_live_match_metrics()
returns table(
  online_now bigint,
  waiting_now bigint,
  avg_wait_seconds numeric,
  waiting_over_1m bigint,
  waiting_over_3m bigint,
  waiting_over_5m bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(distinct user_id) from public.online_activity where seen_at >= now() - interval '5 minutes')::bigint,
    (select count(*) from public.random_match_queue where status = 'waiting')::bigint,
    (select coalesce(avg(extract(epoch from (now() - joined_at))),0) from public.random_match_queue where status = 'waiting')::numeric,
    (select count(*) from public.random_match_queue where status = 'waiting' and joined_at <= now() - interval '1 minute')::bigint,
    (select count(*) from public.random_match_queue where status = 'waiting' and joined_at <= now() - interval '3 minutes')::bigint,
    (select count(*) from public.random_match_queue where status = 'waiting' and joined_at <= now() - interval '5 minutes')::bigint;
$$;

revoke all on function public.get_admin_live_match_metrics() from public;
grant execute on function public.get_admin_live_match_metrics() to service_role;
