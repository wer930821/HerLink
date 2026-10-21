begin;

create or replace function public.station_mail_admin_manual_identity_preflight(
  p_thread_id uuid,
  p_identity_id uuid
)
returns table(
  thread_id uuid,
  auth_user_id uuid,
  identity_id uuid,
  anonymous_display_name text,
  chat_count bigint,
  message_count bigint,
  contact_count bigint,
  auth_user_bound_identity_id uuid,
  conflict_code text
)
language plpgsql stable security definer set search_path='public'
as $$
declare
  v_auth_user_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users where user_id=auth.uid() and active=true
  ) then raise exception 'not allowed'; end if;

  select t.user_id into v_auth_user_id
  from public.station_mail_threads t
  where t.id=p_thread_id and t.deleted_at is null;
  if v_auth_user_id is null then raise exception 'MAIL_THREAD_NOT_FOUND'; end if;

  return query
  select p_thread_id, v_auth_user_id, p.id, p.anonymous_display_name,
    (select count(*) from public.random_chat_sessions s where s.user_a=p.id or s.user_b=p.id),
    (select count(*) from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=p.id or s.user_b=p.id),
    (select count(*) from public.anonymous_contacts c where c.user_a=p.id or c.user_b=p.id),
    bound.anonymous_identity_id,
    case
      when p.id is null or p.anonymous_mode_enabled is not true then 'ANONYMOUS_IDENTITY_NOT_FOUND'
      when v_auth_user_id=p.id then 'SAME_IDENTITY'
      when bound.anonymous_identity_id is not null and bound.anonymous_identity_id<>p.id then 'AUTH_USER_ALREADY_BOUND'
      when not exists (select 1 from public.profiles replacement where replacement.id=v_auth_user_id and replacement.anonymous_mode_enabled=true) then 'REPLACEMENT_ANONYMOUS_PROFILE_NOT_FOUND'
      else null
    end
  from public.profiles p
  left join public.anonymous_identity_device_state bound on bound.active_auth_user_id=v_auth_user_id
  where p.id=p_identity_id;

  if not found then
    return query select p_thread_id,v_auth_user_id,p_identity_id,null::text,0::bigint,0::bigint,0::bigint,null::uuid,'ANONYMOUS_IDENTITY_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.station_mail_admin_manual_identity_claim(
  p_thread_id uuid,
  p_identity_id uuid,
  p_confirm boolean default false
)
returns table(anonymous_identity_id uuid, active_auth_user_id uuid, generation bigint, chat_count bigint, message_count bigint, contact_count bigint)
language plpgsql security definer set search_path='public'
as $$
declare
  v_auth_user_id uuid;
  before_chat bigint; before_messages bigint; before_contacts bigint;
  after_chat bigint; after_messages bigint; after_contacts bigint;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
  if coalesce(p_confirm,false) is not true then raise exception 'CONFIRMATION_REQUIRED'; end if;
  select t.user_id into v_auth_user_id from public.station_mail_threads t where t.id=p_thread_id and t.deleted_at is null;
  if v_auth_user_id is null then raise exception 'MAIL_THREAD_NOT_FOUND'; end if;
  if exists(select 1 from public.anonymous_identity_device_state s where s.active_auth_user_id=v_auth_user_id and s.anonymous_identity_id<>p_identity_id) then raise exception 'AUTH_USER_ALREADY_BOUND'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_identity_id and p.anonymous_mode_enabled=true) then raise exception 'ANONYMOUS_IDENTITY_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_auth_user_id and p.anonymous_mode_enabled=true) then raise exception 'REPLACEMENT_ANONYMOUS_PROFILE_NOT_FOUND'; end if;
  select count(*) into before_chat from public.random_chat_sessions where user_a=p_identity_id or user_b=p_identity_id;
  select count(*) into before_messages from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=p_identity_id or s.user_b=p_identity_id;
  select count(*) into before_contacts from public.anonymous_contacts where user_a=p_identity_id or user_b=p_identity_id;
  return query select c.anonymous_identity_id,c.active_auth_user_id,c.generation,before_chat,before_messages,before_contacts from public.claim_anonymous_identity_device(p_identity_id,v_auth_user_id) c;
  select count(*) into after_chat from public.random_chat_sessions where user_a=p_identity_id or user_b=p_identity_id;
  select count(*) into after_messages from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=p_identity_id or s.user_b=p_identity_id;
  select count(*) into after_contacts from public.anonymous_contacts where user_a=p_identity_id or user_b=p_identity_id;
  if before_chat<>after_chat or before_messages<>after_messages or before_contacts<>after_contacts then raise exception 'RECOVERY_COUNT_MISMATCH'; end if;
end;
$$;

revoke all on function public.station_mail_admin_manual_identity_preflight(uuid,uuid) from public,anon;
revoke all on function public.station_mail_admin_manual_identity_claim(uuid,uuid,boolean) from public,anon;
grant execute on function public.station_mail_admin_manual_identity_preflight(uuid,uuid) to authenticated;
grant execute on function public.station_mail_admin_manual_identity_claim(uuid,uuid,boolean) to authenticated;
commit;
