begin;

create or replace function public.claim_anonymous_identity_device(p_identity_id uuid,p_new_auth_user_id uuid)
returns table (anonymous_identity_id uuid, active_auth_user_id uuid, generation bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.anonymous_identity_device_state%rowtype;
begin
  if not exists(select 1 from public.profiles p where p.id=p_identity_id and p.anonymous_mode_enabled=true) then raise exception 'ANONYMOUS_IDENTITY_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_new_auth_user_id and p.anonymous_mode_enabled=true) then raise exception 'REPLACEMENT_ANONYMOUS_PROFILE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_identity_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_new_auth_user_id::text,0));
  if exists(select 1 from public.anonymous_identity_device_state s where s.active_auth_user_id=p_new_auth_user_id and s.anonymous_identity_id<>p_identity_id) then raise exception 'AUTH_USER_ALREADY_BOUND'; end if;
  select s.* into v_state from public.anonymous_identity_device_state s where s.anonymous_identity_id=p_identity_id for update;
  if v_state.anonymous_identity_id is null then
    insert into public.anonymous_identity_device_state(anonymous_identity_id,active_auth_user_id,generation)
    values(p_identity_id,p_new_auth_user_id,1)
    returning anonymous_identity_device_state.* into v_state;
  else
    update public.anonymous_identity_device_state s
    set active_auth_user_id=p_new_auth_user_id,
        generation=s.generation+1,
        updated_at=timezone('utc'::text,now())
    where s.anonymous_identity_id=p_identity_id
    returning s.* into v_state;
  end if;
  insert into public.anonymous_identity_binding_history(anonymous_identity_id,active_auth_user_id,generation)
  values(v_state.anonymous_identity_id,v_state.active_auth_user_id,v_state.generation);
  return query select v_state.anonymous_identity_id,v_state.active_auth_user_id,v_state.generation;
end;
$$;

revoke all on function public.claim_anonymous_identity_device(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_anonymous_identity_device(uuid,uuid) to service_role;

commit;
