
create or replace function public.start_anonymous_contact_session(p_contact_id uuid)
returns table(status text, session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  c public.anonymous_contacts%rowtype;
  partner_id uuid;
  pair_session public.random_chat_sessions%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select ac.* into c
  from public.anonymous_contacts ac
  where ac.id = p_contact_id
    and ac.status = 'active'
    and ac.user_a_approved = true
    and ac.user_b_approved = true
    and (ac.user_a = actor_id or ac.user_b = actor_id);

  if not found then
    raise exception 'Anonymous contact is not active.';
  end if;

  partner_id := case when c.user_a = actor_id then c.user_b else c.user_a end;

  if public.has_block_between(actor_id, partner_id) then
    raise exception 'This connection is no longer available.';
  end if;

  select s.* into pair_session
  from public.random_chat_sessions s
  where s.user_a = least(actor_id, partner_id)
    and s.user_b = greatest(actor_id, partner_id)
  limit 1;

  if found and pair_session.status = 'active' then
    return query select 'existing'::text, pair_session.id;
    return;
  end if;

  if exists (
    select 1
    from public.random_chat_sessions s
    where s.status = 'active'
      and (s.user_a = actor_id or s.user_b = actor_id)
      and (pair_session.id is null or s.id <> pair_session.id)
  ) then
    raise exception 'You already have an active anonymous chat.';
  end if;

  if exists (
    select 1
    from public.random_chat_sessions s
    where s.status = 'active'
      and (s.user_a = partner_id or s.user_b = partner_id)
      and (pair_session.id is null or s.id <> pair_session.id)
  ) then
    raise exception 'This contact is currently in another chat.';
  end if;

  if pair_session.id is not null then
    update public.random_chat_sessions s
    set status = 'active',
        ended_at = null,
        ended_by = null,
        ended_reason = null
    where s.id = pair_session.id;

    update public.random_match_queue q
    set status = 'left',
        matched_session_id = null,
        updated_at = timezone('utc', now())
    where q.user_id in (actor_id, partner_id)
      and q.status = 'waiting';

    return query select 'existing'::text, pair_session.id;
    return;
  end if;

  insert into public.random_chat_sessions (user_a, user_b, status, created_at)
  values (
    least(actor_id, partner_id),
    greatest(actor_id, partner_id),
    'active',
    timezone('utc', now())
  )
  returning id into pair_session.id;

  update public.random_match_queue q
  set status = 'left',
      matched_session_id = null,
      updated_at = timezone('utc', now())
  where q.user_id in (actor_id, partner_id)
    and q.status = 'waiting';

  return query select 'created'::text, pair_session.id;
end;
$$;

revoke execute on function public.start_anonymous_contact_session(uuid) from public, anon;
grant execute on function public.start_anonymous_contact_session(uuid) to authenticated, service_role;
