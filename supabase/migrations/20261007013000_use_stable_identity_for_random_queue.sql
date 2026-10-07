create or replace function public.find_or_join_random_match()
returns table(status text, session_id uuid, matched_user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  active_count integer;
begin
  if auth.uid() is null or actor_id is null then
    raise exception 'Authentication required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking',0));
  select count(*) into active_count
  from public.random_chat_sessions s
  where s.status='active' and (s.user_a=actor_id or s.user_b=actor_id);
  if active_count>=3 then
    return query select 'limit_reached'::text,null::uuid,null::uuid;
    return;
  end if;
  return query select * from public.join_random_match_internal(actor_id,null);
end;
$function$;

create or replace function public.get_my_random_queue()
returns setof public.random_match_queue
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
  select q.*
  from public.random_match_queue q
  where auth.uid() is not null
    and q.user_id = public.resolve_active_anonymous_chat_identity()
  limit 1;
$function$;

grant execute on function public.get_my_random_queue() to authenticated;
