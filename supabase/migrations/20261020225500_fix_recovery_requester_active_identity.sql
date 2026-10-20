-- Admin recovery is requested by the caller's transient auth uid. Approval must
-- bind the selected existing anonymous identity to that auth uid; it must not
-- require a new profile row for the requester or rewrite historical chat ids.

create or replace function public.approve_random_session_recovery(p_recovery_code text, p_side text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_req public.anonymous_session_recovery_requests%rowtype;
  v_old uuid;
  v_generation bigint;
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
  if v_req.requester_user_id is null or not exists(
    select 1 from auth.users where id=v_req.requester_user_id
  ) then
    raise exception '恢復失敗：找不到請求者的登入身分，請使用者重新申請恢復碼。';
  end if;

  select case when p_side='a' then user_a else user_b end
  into v_old
  from public.random_chat_sessions
  where id=v_req.session_id and status='active'
  for update;

  if v_old is null or not exists(
    select 1 from public.profiles
    where id=v_old and anonymous_mode_enabled=true
  ) then
    raise exception '恢復失敗：原匿名身分不存在。';
  end if;

  -- A recovery code proves only which side the admin selected. The requester's
  -- current auth uid becomes the active device for that existing anonymous
  -- identity. Sessions, messages and contacts stay attached to the canonical
  -- old identity, so no history rewrite or replacement profile is required.
  perform pg_advisory_xact_lock(hashtextextended(v_old::text,0));
  perform pg_advisory_xact_lock(hashtextextended(v_req.requester_user_id::text,0));

  delete from public.anonymous_identity_device_state
  where active_auth_user_id=v_req.requester_user_id
    and anonymous_identity_id<>v_old;

  select generation into v_generation
  from public.anonymous_identity_device_state
  where anonymous_identity_id=v_old
  for update;

  if found then
    update public.anonymous_identity_device_state
    set active_auth_user_id=v_req.requester_user_id,
        generation=generation+1,
        updated_at=timezone('utc',now())
    where anonymous_identity_id=v_old;
  else
    insert into public.anonymous_identity_device_state(
      anonymous_identity_id,active_auth_user_id,generation,updated_at
    ) values(v_old,v_req.requester_user_id,1,timezone('utc',now()));
  end if;

  update public.anonymous_session_recovery_requests
  set status='approved',resolved_at=now()
  where id=v_req.id;

  return true;
exception
  when unique_violation then
    raise exception '恢復失敗：目前登入身分已有衝突的匿名身分，所有變更已回滾。';
end
$$;
