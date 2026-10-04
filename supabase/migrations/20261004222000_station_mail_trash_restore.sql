alter table public.station_mail_threads add column if not exists deleted_at timestamptz;

create or replace function public.station_mail_admin_inbox(p_trash boolean default false)
returns table(id uuid,user_id uuid,subject text,category text,status text,created_at timestamptz,updated_at timestamptz,admin_last_read_at timestamptz,user_last_read_at timestamptz,unread boolean,deleted_at timestamptz)
language sql security definer set search_path='public'
as $$
 select t.id,t.user_id,t.subject,t.category,t.status,t.created_at,t.updated_at,t.admin_last_read_at,t.user_last_read_at,
   (t.deleted_at is null and (t.admin_last_read_at is null or exists(select 1 from station_mail_messages m where m.thread_id=t.id and m.sender_role='user' and m.created_at>t.admin_last_read_at))),t.deleted_at
 from station_mail_threads t
 where exists(select 1 from admin_users a where a.user_id=auth.uid() and a.active=true)
 and ((p_trash and t.deleted_at is not null) or (not p_trash and t.deleted_at is null))
 order by coalesce(t.deleted_at,t.updated_at) desc;
$$;

create or replace function public.station_mail_admin_trash(p_thread_id uuid) returns boolean language plpgsql security definer set search_path='public' as $$ begin
 if auth.uid() is null or not exists(select 1 from admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
 update station_mail_threads set deleted_at=now() where id=p_thread_id and deleted_at is null; return found; end $$;

create or replace function public.station_mail_admin_restore(p_thread_id uuid) returns boolean language plpgsql security definer set search_path='public' as $$ begin
 if auth.uid() is null or not exists(select 1 from admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
 update station_mail_threads set deleted_at=null where id=p_thread_id and deleted_at is not null; return found; end $$;

create or replace function public.station_mail_admin_delete(p_thread_id uuid) returns boolean language plpgsql security definer set search_path='public','storage' as $$ begin
 if auth.uid() is null or not exists(select 1 from public.admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
 if not exists(select 1 from public.station_mail_threads where id=p_thread_id and deleted_at is not null) then return false; end if;
 delete from storage.objects where bucket_id='station-mail' and name in (select attachment_path from public.station_mail_messages where thread_id=p_thread_id and attachment_path is not null);
 delete from public.station_mail_threads where id=p_thread_id and deleted_at is not null; return found; end $$;

revoke all on function public.station_mail_admin_inbox(boolean) from public,anon;
revoke all on function public.station_mail_admin_trash(uuid) from public,anon;
revoke all on function public.station_mail_admin_restore(uuid) from public,anon;
revoke all on function public.station_mail_admin_delete(uuid) from public,anon;
grant execute on function public.station_mail_admin_inbox(boolean) to authenticated;
grant execute on function public.station_mail_admin_trash(uuid) to authenticated;
grant execute on function public.station_mail_admin_restore(uuid) to authenticated;
grant execute on function public.station_mail_admin_delete(uuid) to authenticated;

create or replace function public.station_mail_admin_unread_count() returns integer language sql security definer set search_path='public' as $$
 select case when exists(select 1 from admin_users a where a.user_id=auth.uid() and a.active=true)
 then (select count(*)::integer from station_mail_threads t where t.deleted_at is null and exists(select 1 from station_mail_messages m where m.thread_id=t.id and m.sender_role='user' and (t.admin_last_read_at is null or m.created_at>t.admin_last_read_at))) else 0 end;
$$;