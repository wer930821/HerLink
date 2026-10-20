-- Recovery requests must store the stable anonymous identity, not the transient
-- auth user id. Also repair already-pending requests created before this fix by
-- resolving requester_user_id through anonymous_identity_device_state.

create or replace function public.request_random_session_recovery(p_session_id uuid)
returns table(recovery_code text, expires_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare
  v_actor uuid := public.resolve_active_anonymous_chat_identity();
  v_code text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor) then
    raise exception 'anonymous identity unavailable';
  end if;
  if not exists(
    select 1 from public.random_chat_sessions
    where id=p_session_id and status='active'
  ) then raise exception 'session unavailable'; end if;

  update public.anonymous_session_recovery_requests
  set status='expired', resolved_at=now()
  where requester_user_id=v_actor and session_id=p_session_id and status='pending';

  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.anonymous_session_recovery_requests(
    session_id, requester_user_id, recovery_code, expires_at
  ) values(p_session_id, v_actor, v_code, null);
  return query select v_code, null::timestamptz;
end $$;

revoke all on function public.request_random_session_recovery(uuid) from public,anon;
grant execute on function public.request_random_session_recovery(uuid) to authenticated;

create or replace function public.approve_random_session_recovery(p_recovery_code text, p_side text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_req public.anonymous_session_recovery_requests%rowtype;
  v_requester uuid;
  v_old uuid;
  v_new_a uuid;
  v_new_b uuid;
  v_conflict boolean;
begin
  if auth.uid() is null or not public.can_use_chat_assistant() then
    raise exception 'admin required';
  end if;

  select * into v_req
  from public.anonymous_session_recovery_requests
  where recovery_code=upper(trim(p_recovery_code))
    and status='pending'
    and (expires_at is null or expires_at>now())
  for update;

  if not found then raise exception 'recovery request unavailable'; end if;
  if p_side not in ('a','b') then raise exception 'invalid side'; end if;

  -- New requests already contain the stable identity. For legacy requests,
  -- requester_user_id may instead be the transient auth uid; prefer its active
  -- stable mapping when one exists.
  select coalesce(
    (select s.anonymous_identity_id
       from public.anonymous_identity_device_state s
      where s.active_auth_user_id=v_req.requester_user_id
      limit 1),
    v_req.requester_user_id
  ) into v_requester;

  if v_requester is null or not exists(
    select 1 from public.profiles where id=v_requester
  ) then
    raise exception '恢復失敗：找不到請求者的身分，請使用者重新申請恢復碼。';
  end if;

  -- Persist the repaired requester so retries and admin inspection use the
  -- canonical identity from now on.
  if v_req.requester_user_id is distinct from v_requester then
    update public.anonymous_session_recovery_requests
    set requester_user_id=v_requester
    where id=v_req.id;
    v_req.requester_user_id:=v_requester;
  end if;

  select case when p_side='a' then user_a else user_b end
  into v_old
  from public.random_chat_sessions
  where id=v_req.session_id and status='active'
  for update;

  if v_old is null then raise exception 'session unavailable'; end if;

  if exists(
    select 1 from public.random_chat_sessions
    where id=v_req.session_id
      and (user_a=v_requester or user_b=v_requester)
  ) then
    update public.anonymous_session_recovery_requests
    set status='approved', resolved_at=now()
    where id=v_req.id;
    return true;
  end if;

  select exists(
    select 1
    from public.anonymous_contacts src
    join public.anonymous_contacts dst
      on dst.id<>src.id
     and dst.status='active'
     and (dst.user_a=v_requester or dst.user_b=v_requester)
     and (case when dst.user_a=v_requester then dst.user_b else dst.user_a end)
       = (case when src.user_a=v_old then src.user_b else src.user_a end)
    where src.status='active'
      and (src.user_a=v_old or src.user_b=v_old)
  ) into v_conflict;

  if v_conflict then
    raise exception '恢復失敗：目前身分與原身分存在重複聯絡人，請人工檢查。';
  end if;

  v_new_a := case when p_side='a' then v_requester else (select user_a from public.random_chat_sessions where id=v_req.session_id) end;
  v_new_b := case when p_side='b' then v_requester else (select user_b from public.random_chat_sessions where id=v_req.session_id) end;

  update public.random_chat_sessions
  set user_a=least(v_new_a,v_new_b), user_b=greatest(v_new_a,v_new_b)
  where id=v_req.session_id;

  update public.random_chat_messages
  set sender_id=v_requester
  where session_id=v_req.session_id and sender_id=v_old;

  update public.anonymous_contacts
  set user_a=least(
        case when user_a=v_old then v_requester else user_a end,
        case when user_b=v_old then v_requester else user_b end),
      user_b=greatest(
        case when user_a=v_old then v_requester else user_a end,
        case when user_b=v_old then v_requester else user_b end),
      requested_by=case when requested_by=v_old then v_requester else requested_by end,
      updated_at=now()
  where status='active' and (user_a=v_old or user_b=v_old);

  update public.anonymous_session_recovery_requests
  set status='approved',resolved_at=now()
  where id=v_req.id;

  return true;
exception
  when unique_violation then
    raise exception '恢復失敗：聯絡人或聊天室存在唯一值衝突，所有變更已回滾。';
end
$$;
