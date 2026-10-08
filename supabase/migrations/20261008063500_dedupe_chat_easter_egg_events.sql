-- Prevent repeated text/time easter egg events from flooding a chat.
-- A user can unlock each non-milestone egg once per chat per Taipei day.
create or replace function public.record_chat_easter_egg_event(
  p_session_id uuid, p_egg_kind text, p_trigger_type text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  event_id uuid;
  ua uuid;
  ub uuid;
begin
  if auth.uid() is null or actor_id is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if coalesce(trim(p_egg_kind),'')='' then raise exception 'Missing egg kind' using errcode='22023'; end if;
  if p_trigger_type not in ('text','milestone') then raise exception 'Invalid trigger type' using errcode='22023'; end if;

  select s.user_a, s.user_b into ua, ub
  from public.random_chat_sessions s
  where s.id=p_session_id and (s.user_a=actor_id or s.user_b=actor_id);
  if not found then
    raise exception 'Current identity is not this chat participant' using errcode='P0001';
  end if;

  if p_egg_kind='thousand' then
    insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
    values(p_session_id,actor_id,p_egg_kind,p_trigger_type)
    on conflict (session_id) where egg_kind='thousand' do nothing
    returning id into event_id;

    if event_id is null then
      select id into event_id
      from public.chat_easter_egg_events
      where session_id=p_session_id and egg_kind='thousand'
      limit 1;
    end if;

    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(event_id,p_session_id,ua)
    on conflict(event_id,user_id) do nothing;
    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(event_id,p_session_id,ub)
    on conflict(event_id,user_id) do nothing;
  elsif p_trigger_type='text' then
    select id into event_id
    from public.chat_easter_egg_events
    where session_id=p_session_id
      and user_id=actor_id
      and egg_kind=p_egg_kind
      and trigger_type=p_trigger_type
      and (created_at at time zone 'Asia/Taipei')::date=(now() at time zone 'Asia/Taipei')::date
    order by created_at desc
    limit 1;

    if event_id is null then
      insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
      values(p_session_id,actor_id,p_egg_kind,p_trigger_type)
      returning id into event_id;
    end if;
  else
    select id into event_id
    from public.chat_easter_egg_events
    where session_id=p_session_id
      and user_id=actor_id
      and egg_kind=p_egg_kind
      and trigger_type=p_trigger_type
    order by created_at desc
    limit 1;

    if event_id is null then
      insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
      values(p_session_id,actor_id,p_egg_kind,p_trigger_type)
      returning id into event_id;
    end if;
  end if;

  return event_id;
end
$function$;
