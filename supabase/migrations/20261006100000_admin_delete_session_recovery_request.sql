create or replace function public.admin_delete_session_recovery_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null or not public.can_use_chat_assistant() then
    raise exception 'admin required';
  end if;

  delete from public.anonymous_session_recovery_requests
  where id = p_request_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.admin_delete_session_recovery_request(uuid) from public;
grant execute on function public.admin_delete_session_recovery_request(uuid) to authenticated;
