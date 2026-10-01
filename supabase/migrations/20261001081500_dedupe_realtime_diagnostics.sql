
create or replace function public.record_realtime_diagnostic(
  p_session_id uuid,
  p_event_type text,
  p_client_instance_id text,
  p_message_id uuid default null::uuid,
  p_safe_error_code text default null::text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  inserted_id uuid;
  normalized_event_type text := lower(btrim(coalesce(p_event_type, '')));
  normalized_client_id text := btrim(coalesce(p_client_instance_id, ''));
  normalized_error_code text := nullif(btrim(coalesce(p_safe_error_code, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_session_id is null then
    raise exception 'Session id is required.';
  end if;

  if normalized_client_id = '' then
    raise exception 'Client instance id is required.';
  end if;

  if normalized_event_type not in (
    'realtime_subscribe_started',
    'realtime_subscribed',
    'realtime_subscribe_error',
    'realtime_disconnected',
    'realtime_reconnected',
    'message_received_realtime',
    'message_loaded_from_db'
  ) then
    raise exception 'Unsupported realtime diagnostic event.';
  end if;

  if not exists (
    select 1
    from public.random_chat_sessions as session_row
    where session_row.id = p_session_id
      and (session_row.user_a = actor_id or session_row.user_b = actor_id)
  ) then
    raise exception 'Session is not available.';
  end if;

  if p_message_id is not null and not exists (
    select 1
    from public.random_chat_messages as message_row
    where message_row.id = p_message_id
      and message_row.session_id = p_session_id
  ) then
    raise exception 'Message is not available.';
  end if;

  -- Connection lifecycle events can repeat rapidly during reconnect loops.
  -- Keep one identical event per client/session/error code within two minutes.
  if normalized_event_type in (
    'realtime_subscribe_started',
    'realtime_subscribed',
    'realtime_subscribe_error',
    'realtime_disconnected',
    'realtime_reconnected'
  ) then
    select d.id
    into inserted_id
    from public.realtime_diagnostics d
    where d.session_id = p_session_id
      and d.user_id = actor_id
      and d.client_instance_id = normalized_client_id
      and d.event_type = normalized_event_type
      and coalesce(d.safe_error_code, '') = coalesce(normalized_error_code, '')
      and d.created_at >= now() - interval '2 minutes'
    order by d.created_at desc
    limit 1;

    if inserted_id is not null then
      return inserted_id;
    end if;
  end if;

  insert into public.realtime_diagnostics (
    session_id,
    user_id,
    event_type,
    message_id,
    client_instance_id,
    safe_error_code,
    metadata,
    created_at
  )
  values (
    p_session_id,
    actor_id,
    normalized_event_type,
    p_message_id,
    normalized_client_id,
    normalized_error_code,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
