create or replace function public.get_my_collection_game_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
 c uuid:=public.resolve_active_anonymous_chat_identity();
 kinds text[]:=array[]::text[];
 claims text[]:=array[]::text[];
 sent integer:=0; today_count integer:=0; sess integer:=0; maxmsg integer:=0; textcount integer:=0; distinctcount integer:=0;
 egg_xp integer:=0; reward_xp integer:=0; xp integer:=0; lvl integer:=1;
begin
 if c is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 select coalesce(array_agg(distinct z.kind order by z.kind),array[]::text[]) into kinds from (
   select e.egg_kind kind
   from public.chat_easter_egg_events e
   where e.user_id=c
   union
   select e.egg_kind kind
   from public.chat_easter_egg_deliveries d
   join public.chat_easter_egg_events e on e.id=d.event_id
   where d.user_id=c
   union
   select b.egg_kind kind
   from public.collection_backfill_unlocks b
   where b.user_id=c
 ) z;
 select coalesce(array_agg(r.reward_key order by r.reward_key),array[]::text[]),coalesce(sum(r.xp_awarded),0)::int
 into claims,reward_xp from public.collection_reward_claims r where r.user_id=c;
 select count(*)::int into sent from public.random_chat_messages m where m.sender_id=c;
 select count(*)::int into today_count from public.random_chat_messages m where m.sender_id=c and m.created_at >= date_trunc('day',now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
 select count(*)::int into sess from public.random_chat_sessions s where s.user_a=c or s.user_b=c;
 select coalesce(max(q.cnt),0)::int into maxmsg from (select count(*) cnt from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=c or s.user_b=c group by m.session_id) q;
 select count(distinct z.kind)::int into textcount from (
   select e.egg_kind kind
   from public.chat_easter_egg_events e
   where e.user_id=c and e.trigger_type='text'
   union
   select e.egg_kind kind
   from public.chat_easter_egg_deliveries d
   join public.chat_easter_egg_events e on e.id=d.event_id
   where d.user_id=c and e.trigger_type='text'
 ) z;
 distinctcount:=coalesce(array_length(kinds,1),0);
 egg_xp:=distinctcount*100;
 xp:=egg_xp+reward_xp;
 lvl:=least(100,greatest(1,(xp/250)+1));
 return jsonb_build_object('xp',xp,'level',lvl,'level_xp',case when lvl>=100 then 0 else xp%250 end,'next_level_xp',case when lvl>=100 then 0 else 250 end,'today_sent',today_count,'sent_total',sent,'sessions',sess,'max_messages',maxmsg,'distinct_eggs',distinctcount,'text_eggs',textcount,'egg_kinds',to_jsonb(kinds),'claimed',to_jsonb(claims));
end
$function$;
