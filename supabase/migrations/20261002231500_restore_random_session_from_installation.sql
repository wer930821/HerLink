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
