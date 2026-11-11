-- Preserve the selected anonymous profile as the canonical owner of its
-- existing chats. Admin recovery only binds the requester's auth principal to
-- that stable identity; it does not move or rename the source identity.
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
  v_state public.anonymous_identity_device_state%rowtype;
begin
  if v_admin is null or not public.can_use_chat_assistant() then
    raise exception '恢復失敗：需要管理員權限。';
  end if;
  if p_side is null or p_side not in ('a','b') then
    raise exception '恢復失敗：方別不正確。';
  end if;
  if p_target_user_id is null then
    raise exception '恢復失敗：找不到目前 Web 身分。';
  end if;

  select * into v_s
  from public.random_chat_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception '恢復失敗：找不到聊天室。';
  end if;

  v_source := case when p_side='a' then v_s.user_a else v_s.user_b end;
  v_other := case when p_side='a' then v_s.user_b else v_s.user_a end;

  if v_source is null then
    raise exception '恢復失敗：所選方別沒有匿名身分。';
  end if;
  if v_other = p_target_user_id then
    raise exception '恢復失敗：目前 Web 身分已是聊天室另一方。';
  end if;

  perform 1
  from public.profiles
  where id in (v_source, p_target_user_id)
  order by id
  for update;

  if not exists (select 1 from public.profiles where id = v_source) then
    raise exception '恢復失敗：原匿名名稱不存在。';
  end if;
  if not exists (select 1 from public.profiles where id = p_target_user_id) then
    raise exception '恢復失敗：找不到目前 Web 身分。';
  end if;

  -- Lock the canonical row before replacing any stale mapping for this auth
  -- principal. This branch also handles a retry without changing chat data.
  select * into v_state
  from public.anonymous_identity_device_state
  where anonymous_identity_id = v_source
  for update;

  delete from public.anonymous_identity_device_state
  where active_auth_user_id = p_target_user_id
    and anonymous_identity_id <> v_source;

  if v_state.anonymous_identity_id is null then
    insert into public.anonymous_identity_device_state(
      anonymous_identity_id, active_auth_user_id, generation, updated_at
    ) values (v_source, p_target_user_id, 1, timezone('utc'::text, now()));
  else
    update public.anonymous_identity_device_state
    set active_auth_user_id = p_target_user_id,
        generation = generation + 1,
        updated_at = timezone('utc'::text, now())
    where anonymous_identity_id = v_source;
  end if;

  return v_s;
exception
  when unique_violation then
    raise exception '恢復失敗：穩定身分已綁定其他裝置或發生唯一值衝突，所有變更已回滾。';
end
$function$;
