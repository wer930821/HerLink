create or replace function public.list_admin_random_sessions(
  p_status text default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table(
  id uuid, user_a uuid, user_b uuid, status text, created_at timestamptz,
  ended_at timestamptz, ended_by uuid, ended_reason text,
  message_count bigint, last_message_at timestamptz, total_count bigint
)
language sql security definer set search_path = public
as $$
  with decorated as (
    select s.id, s.user_a, s.user_b, s.status::text, s.created_at, s.ended_at, s.ended_by,
      s.ended_reason::text, count(m.id)::bigint as message_count, max(m.created_at) as last_message_at
    from public.random_chat_sessions s
    left join public.random_chat_messages m on m.session_id = s.id
    where p_status is null or p_status = 'all' or s.status::text = p_status
    group by s.id
  )
  select d.*, count(*) over()::bigint as total_count
  from decorated d
  order by d.last_message_at desc nulls last, d.created_at desc
  offset greatest(coalesce(p_offset,0),0)
  limit least(greatest(coalesce(p_limit,20),1),100);
$$;
revoke all on function public.list_admin_random_sessions(text,integer,integer) from public;
grant execute on function public.list_admin_random_sessions(text,integer,integer) to service_role;
