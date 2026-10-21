begin;

create or replace function public.station_mail_admin_resolve(p_thread_id uuid)
returns boolean
language plpgsql
security definer
set search_path='public'
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from admin_users where user_id=auth.uid() and active=true
  ) then
    raise exception 'not allowed';
  end if;

  update station_mail_threads
  set status='resolved',
      admin_last_read_at=now(),
      updated_at=now()
  where id=p_thread_id
    and deleted_at is null
    and status <> 'resolved';

  return found;
end
$$;

revoke all on function public.station_mail_admin_resolve(uuid) from public,anon;
grant execute on function public.station_mail_admin_resolve(uuid) to authenticated;

commit;
