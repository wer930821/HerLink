-- Ensure the Legendary (1000-message) easter egg is idempotent per chat session.
-- Existing duplicate thousand events are collapsed into the earliest event.
-- Delivery history is merged onto that canonical event, then both participants
-- are guaranteed to have exactly one delivery row for it.

do $$
declare
  rec record;
  canonical_id uuid;
  ua uuid;
  ub uuid;
  d record;
begin
  for rec in
    select session_id
    from public.chat_easter_egg_events
    where egg_kind = 'thousand'
    group by session_id
    having count(*) > 1
  loop
    select e.id into canonical_id
    from public.chat_easter_egg_events e
    where e.session_id = rec.session_id and e.egg_kind = 'thousand'
    order by e.created_at asc, e.id asc
    limit 1;

    select s.user_a, s.user_b into ua, ub
    from public.random_chat_sessions s
    where s.id = rec.session_id;

    for d in
      select user_id, min(displayed_at) displayed_at, max(duration_ms) duration_ms,
             max(completed_at) completed_at, max(client_version) client_version
      from public.chat_easter_egg_deliveries
      where session_id = rec.session_id
        and event_id in (
          select id from public.chat_easter_egg_events
          where session_id = rec.session_id and egg_kind = 'thousand'
        )
      group by user_id
    loop
      insert into public.chat_easter_egg_deliveries(
        event_id, session_id, user_id, displayed_at, duration_ms, completed_at, client_version
      ) values (
        canonical_id, rec.session_id, d.user_id, d.displayed_at,
        d.duration_ms, d.completed_at, d.client_version
      )
      on conflict (event_id, user_id) do update
      set displayed_at = least(public.chat_easter_egg_deliveries.displayed_at, excluded.displayed_at),
          duration_ms = coalesce(public.chat_easter_egg_deliveries.duration_ms, excluded.duration_ms),
          completed_at = coalesce(public.chat_easter_egg_deliveries.completed_at, excluded.completed_at),
          client_version = coalesce(public.chat_easter_egg_deliveries.client_version, excluded.client_version);
    end loop;

    delete from public.chat_easter_egg_events
    where session_id = rec.session_id and egg_kind = 'thousand' and id <> canonical_id;

    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(canonical_id,rec.session_id,ua)
    on conflict(event_id,user_id) do nothing;
    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(canonical_id,rec.session_id,ub)
    on conflict(event_id,user_id) do nothing;
  end loop;

  for rec in
    select e.id event_id, e.session_id, s.user_a, s.user_b
    from public.chat_easter_egg_events e
    join public.random_chat_sessions s on s.id=e.session_id
    where e.egg_kind='thousand'
  loop
    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(rec.event_id,rec.session_id,rec.user_a)
    on conflict(event_id,user_id) do nothing;
    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(rec.event_id,rec.session_id,rec.user_b)
    on conflict(event_id,user_id) do nothing;
  end loop;
end $$;

create unique index if not exists chat_easter_egg_events_one_thousand_per_session
on public.chat_easter_egg_events(session_id)
where egg_kind='thousand';

create or replace function public.record_chat_easter_egg_event(
  p_session_id uuid, p_egg_kind text, p_trigger_type text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  event_id uuid;
  ua uuid;
  ub uuid;
begin
  if caller is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if coalesce(trim(p_egg_kind),'')='' then raise exception 'Missing egg kind' using errcode='22023'; end if;
  if p_trigger_type not in ('text','milestone') then raise exception 'Invalid trigger type' using errcode='22023'; end if;

  select s.user_a, s.user_b into ua, ub
  from public.random_chat_sessions s
  where s.id=p_session_id and (s.user_a=caller or s.user_b=caller);
  if not found then
    raise exception 'Current identity is not this chat participant' using errcode='P0001';
  end if;

  if p_egg_kind='thousand' then
    insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
    values(p_session_id,caller,p_egg_kind,p_trigger_type)
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
  else
    insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
    values(p_session_id,caller,p_egg_kind,p_trigger_type)
    returning id into event_id;
  end if;

  return event_id;
end
$function$;
