drop function if exists public.list_admin_random_sessions(text,integer,integer);
create function public.list_admin_random_sessions(p_status text default null,p_offset integer default 0,p_limit integer default 20)
returns table(id uuid,created_at timestamptz,status text,user_a uuid,user_b uuid,ended_at timestamptz,ended_reason text,message_count bigint,first_message_at timestamptz,last_message_at timestamptz,total_count bigint)
language sql security definer set search_path=public as $$
with rows as (
 select s.id,s.created_at,s.status,s.user_a,s.user_b,s.ended_at,s.ended_reason,
        count(m.id)::bigint message_count,min(m.created_at) first_message_at,max(m.created_at) last_message_at
 from random_chat_sessions s left join random_chat_messages m on m.session_id=s.id
 where p_status is null or s.status=p_status
 group by s.id
), ranked as (select rows.*,count(*) over() total_count from rows)
select id,created_at,status,user_a,user_b,ended_at,ended_reason,message_count,first_message_at,last_message_at,total_count
from ranked order by last_message_at desc nulls last,created_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.list_admin_random_sessions(text,integer,integer) from public;
grant execute on function public.list_admin_random_sessions(text,integer,integer) to service_role;
