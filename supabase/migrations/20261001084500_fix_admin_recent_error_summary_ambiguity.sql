
create or replace function public.get_admin_recent_error_summary()
returns table(
  source text,
  error_code text,
  error_count bigint,
  last_seen timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if auth.role() <> 'service_role' and (
    actor_id is null or not exists (
      select 1
      from public.admin_users au
      where au.user_id = actor_id
        and au.role = 'admin'
        and au.active = true
    )
  ) then
    raise exception 'Admin access required.';
  end if;

  return query
  with combined as (
    select
      'realtime'::text as source,
      coalesce(nullif(rd.safe_error_code, ''), 'CHANNEL_ERROR')::text as error_code,
      count(*)::bigint as error_count,
      max(rd.created_at) as last_seen
    from public.realtime_diagnostics rd
    where rd.created_at >= now() - interval '24 hours'
      and rd.event_type = 'realtime_subscribe_error'
    group by coalesce(nullif(rd.safe_error_code, ''), 'CHANNEL_ERROR')

    union all

    select
      'push'::text as source,
      coalesce(nullif(wpd.error_code, ''), wpd.status, 'UNKNOWN')::text as error_code,
      count(*)::bigint as error_count,
      max(wpd.created_at) as last_seen
    from public.web_push_deliveries wpd
    where wpd.created_at >= now() - interval '24 hours'
      and (wpd.status <> 'sent' or wpd.error_code is not null)
    group by coalesce(nullif(wpd.error_code, ''), wpd.status, 'UNKNOWN')

    union all

    select
      'laya'::text as source,
      'FALLBACK_USED'::text as error_code,
      count(*)::bigint as error_count,
      max(cahe.created_at) as last_seen
    from public.chat_assist_health_events cahe
    where cahe.created_at >= now() - interval '24 hours'
      and cahe.engine = 'fallback'
    having count(*) > 0
  )
  select c.source, c.error_code, c.error_count, c.last_seen
  from combined c
  order by c.last_seen desc, c.error_count desc
  limit 8;
end;
$$;

revoke execute on function public.get_admin_recent_error_summary() from public, anon;
grant execute on function public.get_admin_recent_error_summary() to authenticated, service_role;
