-- Allow active administrators to permanently delete a station-mail thread.
-- Messages are removed by the existing ON DELETE CASCADE foreign key.
-- Any private photo attachments for the thread are removed from Storage first.
create or replace function public.station_mail_admin_delete(p_thread_id uuid)
returns boolean
language plpgsql
security definer
set search_path='public','storage'
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.admin_users
    where user_id=auth.uid() and active=true
  ) then
    raise exception 'not allowed';
  end if;

  if not exists(select 1 from public.station_mail_threads where id=p_thread_id) then
    return false;
  end if;

  delete from storage.objects
  where bucket_id='station-mail'
    and name in (
      select attachment_path
      from public.station_mail_messages
      where thread_id=p_thread_id and attachment_path is not null
    );

  delete from public.station_mail_threads where id=p_thread_id;
  return found;
end
$$;

revoke all on function public.station_mail_admin_delete(uuid) from public, anon;
grant execute on function public.station_mail_admin_delete(uuid) to authenticated;
