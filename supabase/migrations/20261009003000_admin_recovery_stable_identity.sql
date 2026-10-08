-- Persist the stable anonymous identity mapping when an admin restores an old
-- anonymous chat identity onto the requester's current auth user.
--
-- The restored profile row is the canonical anonymous identity after the
-- existing admin_restore_random_session_to_user migration has moved the
-- retained sessions/contacts to p_target_user_id.  Recording that identity in
-- anonymous_identity_device_state makes refresh/bootstrap resolve the same
-- identity instead of falling back to a fresh anonymous user.

create or replace function public.admin_restore_random_session_to_user(
  p_session_id uuid,
  p_side text,
  p_target_user_id uuid
)
returns public.random_chat_sessions
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_admin uuid := auth.uid();
  v_s public.random_chat_sessions%rowtype;
  v_source uuid;
  v_other uuid;
  v_name text;
  v_archive text;
  v_try int := 0;
  v_conflict boolean;
begin
  if v_admin is null or not public.can_use_chat_assistant() then
    raise exception '恢復失敗：需要管理員權限。';
  end if;
  if p_side not in ('a','b') then
    raise exception '恢復失敗：方別不正確。';
  end if;

  select * into v_s
  from public.random_chat_sessions
  where id = p_session_id
  for update;
  if not found then raise exception '恢復失敗：找不到聊天室。'; end if;

  v_source := case when p_side='a' then v_s.user_a else v_s.user_b end;
  v_other := case when p_side='a' then v_s.user_b else v_s.user_a end;

  -- Idempotent retry: an earlier restore may already have moved the session.
  -- Still repair the stable mapping instead of returning before doing so.
  if v_source = p_target_user_id then
    delete from public.anonymous_identity_device_state
    where active_auth_user_id = p_target_user_id
      and anonymous_identity_id <> p_target_user_id;

    insert into public.anonymous_identity_device_state(
      anonymous_identity_id, active_auth_user_id, generation, updated_at
    ) values (p_target_user_id, p_target_user_id, 1, timezone('utc', now()))
    on conflict (anonymous_identity_id) do update
      set active_auth_user_id = excluded.active_auth_user_id,
          generation = greatest(public.anonymous_identity_device_state.generation, 1),
          updated_at = excluded.updated_at;
    return v_s;
  end if;

  if v_other = p_target_user_id then
    raise exception '恢復失敗：目前 Web 身分已是聊天室另一方。';
  end if;

  perform 1 from public.profiles
  where id in (v_source,p_target_user_id)
  order by id for update;

  select anonymous_display_name into v_name
  from public.profiles where id=v_source;
  if v_name is null then raise exception '恢復失敗：原匿名名稱不存在。'; end if;
  if not exists(select 1 from public.profiles where id=p_target_user_id) then
    raise exception '恢復失敗：找不到目前 Web 身分。';
  end if;

  select exists (
    select 1
    from public.random_chat_sessions src
    join public.random_chat_sessions dst
      on dst.id <> src.id
     and dst.status = 'active'
     and (dst.user_a = p_target_user_id or dst.user_b = p_target_user_id)
     and (case when dst.user_a=p_target_user_id then dst.user_b else dst.user_a end)
         = (case when src.user_a=v_source then src.user_b else src.user_a end)
    where src.status='active'
      and (src.user_a=v_source or src.user_b=v_source)
  ) or exists (
    select 1
    from public.anonymous_contacts src
    join public.anonymous_contacts dst
      on dst.id <> src.id
     and dst.status='active'
     and (dst.user_a=p_target_user_id or dst.user_b=p_target_user_id)
     and (case when dst.user_a=p_target_user_id then dst.user_b else dst.user_a end)
         = (case when src.user_a=v_source then src.user_b else src.user_a end)
    where src.status='active'
      and (src.user_a=v_source or src.user_b=v_source)
  ) into v_conflict;

  if v_conflict then
    raise exception '恢復失敗：目前身分與原身分存在重複聯絡人，請人工檢查。';
  end if;

  update public.profiles
  set anonymous_display_name=null
  where id in(v_source,p_target_user_id);

  loop
    v_try:=v_try+1;
    v_archive:='舊身分'||substr(md5(v_source::text||v_try::text),1,6);
    exit when not exists(
      select 1 from public.profiles
      where anonymous_display_name_normalized=lower(v_archive)
    );
    if v_try>=20 then raise exception '恢復失敗：無法建立唯一封存名稱。'; end if;
  end loop;

  update public.profiles set anonymous_display_name=v_archive where id=v_source;
  update public.profiles
  set anonymous_mode_enabled=true, anonymous_display_name=v_name
  where id=p_target_user_id;

  update public.random_chat_sessions
  set user_a = least(
        case when user_a=v_source then p_target_user_id else user_a end,
        case when user_b=v_source then p_target_user_id else user_b end),
      user_b = greatest(
        case when user_a=v_source then p_target_user_id else user_a end,
        case when user_b=v_source then p_target_user_id else user_b end)
  where status='active' and (user_a=v_source or user_b=v_source);

  update public.random_chat_messages m
  set sender_id=p_target_user_id
  where sender_id=v_source
    and exists (
      select 1 from public.random_chat_sessions s
      where s.id=m.session_id
        and s.status='active'
        and (s.user_a=p_target_user_id or s.user_b=p_target_user_id)
    );

  update public.random_session_icebreaker_events e
  set actor_id=p_target_user_id
  where actor_id=v_source
    and exists (
      select 1 from public.random_chat_sessions s
      where s.id=e.session_id
        and s.status='active'
        and (s.user_a=p_target_user_id or s.user_b=p_target_user_id)
    );

  update public.anonymous_contacts
  set user_a = least(
        case when user_a=v_source then p_target_user_id else user_a end,
        case when user_b=v_source then p_target_user_id else user_b end),
      user_b = greatest(
        case when user_a=v_source then p_target_user_id else user_a end,
        case when user_b=v_source then p_target_user_id else user_b end),
      requested_by = case when requested_by=v_source then p_target_user_id else requested_by end,
      updated_at = now()
  where status='active' and (user_a=v_source or user_b=v_source);

  -- One auth user may only point at one stable anonymous identity. Remove any
  -- stale mapping for the target before establishing the restored identity.
  delete from public.anonymous_identity_device_state
  where active_auth_user_id = p_target_user_id
    and anonymous_identity_id <> p_target_user_id;

  insert into public.anonymous_identity_device_state(
    anonymous_identity_id, active_auth_user_id, generation, updated_at
  ) values (p_target_user_id, p_target_user_id, 1, timezone('utc', now()))
  on conflict (anonymous_identity_id) do update
    set active_auth_user_id = excluded.active_auth_user_id,
        generation = public.anonymous_identity_device_state.generation + 1,
        updated_at = excluded.updated_at;

  select * into v_s from public.random_chat_sessions where id=p_session_id;
  return v_s;
exception
  when unique_violation then
    raise exception '恢復失敗：名稱、聊天室、聯絡人或穩定身分仍有唯一值衝突，所有變更已回滾。';
end
$function$;
