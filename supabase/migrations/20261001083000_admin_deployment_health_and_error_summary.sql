
create table if not exists public.admin_deployment_health (
  deployment_id text primary key,
  commit_sha text,
  commit_ref text,
  deployment_url text,
  environment text,
  first_healthy_at timestamptz not null default now(),
  last_healthy_at timestamptz not null default now()
);

alter table public.admin_deployment_health enable row level security;
revoke all on table public.admin_deployment_health from public, anon, authenticated;

create or replace function public.record_admin_deployment_health(
  p_deployment_id text,
  p_commit_sha text,
  p_commit_ref text,
  p_deployment_url text,
  p_environment text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  healthy_at timestamptz;
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

  if nullif(btrim(coalesce(p_deployment_id, '')), '') is null then
    return null;
  end if;

  insert into public.admin_deployment_health (
    deployment_id,
    commit_sha,
    commit_ref,
    deployment_url,
    environment,
    first_healthy_at,
    last_healthy_at
  )
  values (
    btrim(p_deployment_id),
    nullif(btrim(coalesce(p_commit_sha, '')), ''),
    nullif(btrim(coalesce(p_commit_ref, '')), ''),
    nullif(btrim(coalesce(p_deployment_url, '')), ''),
    nullif(btrim(coalesce(p_environment, '')), ''),
    now(),
    now()
  )
  on conflict (deployment_id) do update
  set
    commit_sha = excluded.commit_sha,
    commit_ref = excluded.commit_ref,
    deployment_url = excluded.deployment_url,
    environment = excluded.environment,
    last_healthy_at = now();

  select first_healthy_at
  into healthy_at
  from public.admin_deployment_health
  where deployment_id = btrim(p_deployment_id);

  return healthy_at;
end;
$$;

revoke execute on function public.record_admin_deployment_health(text, text, text, text, text) from public, anon;
grant execute on function public.record_admin_deployment_health(text, text, text, text, text) to authenticated, service_role;

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
      from public.admin_users
      where user_id = actor_id
        and role = 'admin'
        and active = true
    )
  ) then
    raise exception 'Admin access required.';
  end if;

  return query
  with combined as (
    select
      'realtime'::text as source,
      coalesce(nullif(safe_error_code, ''), 'CHANNEL_ERROR')::text as error_code,
      count(*)::bigint as error_count,
      max(created_at) as last_seen
    from public.realtime_diagnostics
    where created_at >= now() - interval '24 hours'
      and event_type = 'realtime_subscribe_error'
    group by coalesce(nullif(safe_error_code, ''), 'CHANNEL_ERROR')

    union all

    select
      'push'::text as source,
      coalesce(nullif(error_code, ''), status, 'UNKNOWN')::text as error_code,
      count(*)::bigint as error_count,
      max(created_at) as last_seen
    from public.web_push_deliveries
    where created_at >= now() - interval '24 hours'
      and (status <> 'sent' or error_code is not null)
    group by coalesce(nullif(error_code, ''), status, 'UNKNOWN')

    union all

    select
      'laya'::text as source,
      'FALLBACK_USED'::text as error_code,
      count(*)::bigint as error_count,
      max(created_at) as last_seen
    from public.chat_assist_health_events
    where created_at >= now() - interval '24 hours'
      and engine = 'fallback'
    having count(*) > 0
  )
  select combined.source, combined.error_code, combined.error_count, combined.last_seen
  from combined
  order by combined.last_seen desc, combined.error_count desc
  limit 8;
end;
$$;

revoke execute on function public.get_admin_recent_error_summary() from public, anon;
grant execute on function public.get_admin_recent_error_summary() to authenticated, service_role;
