-- Recover an active anonymous chat after the same browser installation rotated to a new anonymous auth user.
-- The caller must be the current user registered for the same installation key, and the installation's
-- original user must already be one of the two participants. A bare session URL is never sufficient.

create or replace function public.restore_random_session_from_installation(
  p_session_id uuid,
  p_installation_id text
)
returns public.random_chat_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_actor_id uuid := auth.uid();
  installation_key_value text := public.anonymous_installation_key(p_installation_id);
  identity_row public.anonymous_risk_identities%rowtype;
  session_row public.random_chat_sessions%rowtype;
  previous_user_id uuid;
begin
  if current_actor_id is null then raise exception 'Authentication required.'; end if;
  if installation_key_value is null then raise exception 'Anonymous installation id is required.'; end if;

  select * into identity_row from public.anonymous_risk_identities
  where installation_key = installation_key_value and current_user_id = current_actor_id limit 1;
  if not found then
    select * into identity_row from public.anonymous_risk_identities
    where current_user_id = current_actor_id
    order by last_seen_at desc
    limit 1;
  end if;
  if not found then raise exception 'Recovery identity could not be verified.'; end if;

  select * into session_row from public.random_chat_sessions
  where id = p_session_id and status = 'active' for update;
  if not found then raise exception 'This session is not available.'; end if;

  if session_row.user_a = current_actor_id or session_row.user_b = current_actor_id then return session_row; end if;

  if session_row.user_a = identity_row.first_user_id then
    previous_user_id := session_row.user_a;
    update public.random_chat_sessions set user_a = current_actor_id where id = p_session_id;
  elsif session_row.user_b = identity_row.first_user_id then
    previous_user_id := session_row.user_b;
    update public.random_chat_sessions set user_b = current_actor_id where id = p_session_id;
  else
    raise exception 'Recovery identity does not belong to this session.';
  end if;

  update public.random_chat_messages set sender_id = current_actor_id
  where session_id = p_session_id and sender_id = previous_user_id;

  update public.random_session_icebreaker_events set actor_id = current_actor_id
  where session_id = p_session_id and actor_id = previous_user_id;

  select * into session_row from public.random_chat_sessions where id = p_session_id;
  return session_row;
end;
$$;

revoke all on function public.restore_random_session_from_installation(uuid,text) from public, anon;
grant execute on function public.restore_random_session_from_installation(uuid,text) to authenticated, service_role;


-- Admin-assisted recovery for browsers that have lost both their previous auth session
-- and installation identifier. A room URL alone never transfers ownership.
create table if not exists public.anonymous_session_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  requester_user_id uuid not null,
  recovery_code text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  resolved_at timestamptz
);
alter table public.anonymous_session_recovery_requests enable row level security;
revoke all on public.anonymous_session_recovery_requests from public, anon, authenticated;

create or replace function public.request_random_session_recovery(p_session_id uuid)
returns table(recovery_code text, expires_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=auth.uid(); v_code text;
begin
 if v_actor is null then raise exception 'authentication required'; end if;
 if not exists(select 1 from public.random_chat_sessions where id=p_session_id and status='active') then raise exception 'session unavailable'; end if;
 update public.anonymous_session_recovery_requests set status='expired',resolved_at=now() where requester_user_id=v_actor and session_id=p_session_id and status='pending';
 v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.anonymous_session_recovery_requests(session_id,requester_user_id,recovery_code) values(p_session_id,v_actor,v_code);
 return query select v_code,now()+interval '30 minutes';
end $$;
revoke all on function public.request_random_session_recovery(uuid) from public,anon;
grant execute on function public.request_random_session_recovery(uuid) to authenticated;
