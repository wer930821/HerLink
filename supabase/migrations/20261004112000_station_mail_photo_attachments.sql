-- Station mailbox private photo attachments.
alter table public.station_mail_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size integer;

alter table public.station_mail_messages drop constraint if exists station_mail_messages_attachment_mime_check;
alter table public.station_mail_messages add constraint station_mail_messages_attachment_mime_check
  check (attachment_mime is null or attachment_mime in ('image/jpeg','image/png','image/webp'));
alter table public.station_mail_messages drop constraint if exists station_mail_messages_attachment_size_check;
alter table public.station_mail_messages add constraint station_mail_messages_attachment_size_check
  check (attachment_size is null or (attachment_size > 0 and attachment_size <= 5242880));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('station-mail','station-mail',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "station mail user upload" on storage.objects;
create policy "station mail user upload" on storage.objects for insert to authenticated
with check (bucket_id='station-mail' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists "station mail user read own" on storage.objects;
create policy "station mail user read own" on storage.objects for select to authenticated
using (bucket_id='station-mail' and ((storage.foldername(name))[1]=(select auth.uid())::text
  or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()) and a.active=true)));

create or replace function public.station_mail_attach_photo(p_thread_id uuid,p_attachment_path text,p_attachment_mime text,p_attachment_size integer)
returns boolean language plpgsql security definer set search_path='public','storage' as $$
declare v_message_id uuid;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 if p_attachment_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'unsupported attachment type'; end if;
 if p_attachment_size <= 0 or p_attachment_size > 5242880 then raise exception 'attachment too large'; end if;
 if split_part(p_attachment_path,'/',1) <> auth.uid()::text then raise exception 'invalid attachment path'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='station-mail' and o.name=p_attachment_path) then raise exception 'attachment not found'; end if;
 select m.id into v_message_id from public.station_mail_messages m join public.station_mail_threads t on t.id=m.thread_id
 where m.thread_id=p_thread_id and t.user_id=auth.uid() and m.sender_user_id=auth.uid() and m.sender_role='user'
 order by m.created_at asc limit 1;
 if v_message_id is null then raise exception 'mail message not found'; end if;
 update public.station_mail_messages set attachment_path=p_attachment_path,attachment_mime=p_attachment_mime,attachment_size=p_attachment_size where id=v_message_id;
 return true;
end $$;
revoke all on function public.station_mail_attach_photo(uuid,text,text,integer) from public,anon;
grant execute on function public.station_mail_attach_photo(uuid,text,text,integer) to authenticated;
