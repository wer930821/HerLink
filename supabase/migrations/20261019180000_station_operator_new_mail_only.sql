begin;

-- Safety cutoff: never backfill mail that existed before this rollout.
create or replace function public.station_operator_enqueue_unread(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_cutoff constant timestamptz := '2026-10-19 10:00:00+00'::timestamptz;
begin
  with latest_user_message as (
    select distinct on (m.thread_id)
      m.thread_id,
      m.id as message_id,
      m.created_at
    from public.station_mail_messages m
    join public.station_mail_threads t on t.id = m.thread_id
    where t.deleted_at is null
      and m.sender_role = 'user'
      and m.created_at >= v_cutoff
      and (t.admin_last_read_at is null or m.created_at > t.admin_last_read_at)
      and not exists (
        select 1
        from public.station_mail_messages a
        where a.thread_id = m.thread_id
          and a.sender_role = 'admin'
          and a.created_at > m.created_at
      )
    order by m.thread_id, m.created_at desc
  ), ins as (
    insert into public.station_operator_jobs(thread_id, trigger_message_id, kind)
    select l.thread_id, l.message_id, 'triage'
    from latest_user_message l
    where not exists (
      select 1 from public.station_operator_jobs j
      where j.trigger_message_id = l.message_id and j.kind = 'triage'
    )
    order by l.created_at asc
    limit greatest(1, least(coalesce(p_limit,20),50))
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;

revoke execute on function public.station_operator_enqueue_unread(integer) from public, anon, authenticated;
grant execute on function public.station_operator_enqueue_unread(integer) to service_role;

commit;
