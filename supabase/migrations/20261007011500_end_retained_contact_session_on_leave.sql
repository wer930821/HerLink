create or replace function public.leave_random_session(p_session_id uuid default null::uuid)
returns table(ended boolean, session_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  target_session public.random_chat_sessions%rowtype;
  updated_rows integer := 0;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_session_id is not null then
    select s.* into target_session
    from public.random_chat_sessions s
    where s.id = p_session_id
      and (s.user_a = actor_id or s.user_b = actor_id)
    limit 1;
  else
    select s.* into target_session
    from public.random_chat_sessions s
    where s.status = 'active'
      and (s.user_a = actor_id or s.user_b = actor_id)
    order by s.created_at desc
    limit 1;
  end if;

  if target_session.id is null then
    return query select false, null::uuid;
    return;
  end if;

  if target_session.status = 'active' then
    update public.random_chat_sessions s
    set status = 'ended',
        ended_at = timezone('utc'::text, now()),
        ended_by = actor_id,
        ended_reason = 'left'
    where s.id = target_session.id
      and s.status = 'active'
      and (s.user_a = actor_id or s.user_b = actor_id);

    get diagnostics updated_rows = row_count;
    if updated_rows = 0 then
      raise exception 'You are not allowed to end this session.';
    end if;
  elsif target_session.status <> 'ended' then
    raise exception 'You are not allowed to end this session.';
  end if;

  update public.random_match_queue q
  set status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = null
  where q.user_id = actor_id;

  perform public.record_anonymous_risk_event_by_user_id(
    actor_id,
    'session_leave',
    jsonb_build_object('session_id', target_session.id::text)
  );

  return query select true, target_session.id;
end;
$function$;
