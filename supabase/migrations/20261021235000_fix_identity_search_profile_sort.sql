begin;

create or replace function public.station_mail_admin_identity_search(
  p_thread_id uuid,
  p_query text
)
returns table(identity_id uuid, anonymous_display_name text)
language plpgsql stable security definer set search_path='public'
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users where user_id=auth.uid() and active=true) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.station_mail_threads t where t.id=p_thread_id and t.deleted_at is null) then raise exception 'MAIL_THREAD_NOT_FOUND'; end if;
  return query
    select p.id, p.anonymous_display_name
    from public.profiles p
    where p.anonymous_mode_enabled=true
      and nullif(trim(p_query),'') is not null
      and p.anonymous_display_name ilike '%' || trim(p_query) || '%'
    order by p.created_at desc nulls last
    limit 20;
end;
$$;

revoke all on function public.station_mail_admin_identity_search(uuid,text) from public,anon;
grant execute on function public.station_mail_admin_identity_search(uuid,text) to authenticated;
commit;
