create or replace function public.station_mail_user_reply_with_photo(
 p_thread_id uuid,p_body text,p_attachment_path text default null,p_attachment_mime text default null,p_attachment_size integer default null
) returns uuid language plpgsql security definer set search_path='public','storage' as $$
declare v_message_id uuid;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 if not exists(select 1 from public.station_mail_threads t where t.id=p_thread_id and t.user_id=auth.uid()) then raise exception 'mail thread not found'; end if;
 if char_length(trim(coalesce(p_body,'')))<1 or char_length(p_body)>2000 then raise exception 'invalid body'; end if;
 if p_attachment_path is not null then
  if p_attachment_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'unsupported attachment type'; end if;
  if p_attachment_size is null or p_attachment_size<=0 or p_attachment_size>5242880 then raise exception 'attachment too large'; end if;
  if split_part(p_attachment_path,'/',1)<>auth.uid()::text then raise exception 'invalid attachment path'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='station-mail' and o.name=p_attachment_path) then raise exception 'attachment not found'; end if;
 end if;
 insert into public.station_mail_messages(thread_id,sender_user_id,sender_role,body,attachment_path,attachment_mime,attachment_size)
 values(p_thread_id,auth.uid(),'user',trim(p_body),p_attachment_path,p_attachment_mime,p_attachment_size) returning id into v_message_id;
 update public.station_mail_threads set status='open',updated_at=now(),admin_last_read_at=null where id=p_thread_id;
 return v_message_id;
end $$;
revoke all on function public.station_mail_user_reply_with_photo(uuid,text,text,text,integer) from public,anon;
grant execute on function public.station_mail_user_reply_with_photo(uuid,text,text,text,integer) to authenticated;