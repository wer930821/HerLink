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
   select e.egg_kind kind from public.chat_easter_egg_events e where e.user_id=c
   union select b.egg_kind kind from public.collection_backfill_unlocks b where b.user_id=c
 ) z;
 select coalesce(array_agg(r.reward_key order by r.reward_key),array[]::text[]),coalesce(sum(r.xp_awarded),0)::int
 into claims,reward_xp from public.collection_reward_claims r where r.user_id=c;
 select count(*)::int into sent from public.random_chat_messages m where m.sender_id=c;
 select count(*)::int into today_count from public.random_chat_messages m where m.sender_id=c and m.created_at >= date_trunc('day',now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
 select count(*)::int into sess from public.random_chat_sessions s where s.user_a=c or s.user_b=c;
 select coalesce(max(q.cnt),0)::int into maxmsg from (select count(*) cnt from public.random_chat_messages m join public.random_chat_sessions s on s.id=m.session_id where s.user_a=c or s.user_b=c group by m.session_id) q;
 select count(distinct e.egg_kind)::int into textcount from public.chat_easter_egg_events e where e.user_id=c and e.trigger_type='text';
 distinctcount:=coalesce(array_length(kinds,1),0);
 egg_xp:=distinctcount*100;
 xp:=egg_xp+reward_xp;
 lvl:=least(100,greatest(1,(xp/250)+1));
 return jsonb_build_object('xp',xp,'level',lvl,'level_xp',case when lvl>=100 then 0 else xp%250 end,'next_level_xp',case when lvl>=100 then 0 else 250 end,'today_sent',today_count,'sent_total',sent,'sessions',sess,'max_messages',maxmsg,'distinct_eggs',distinctcount,'text_eggs',textcount,'egg_kinds',to_jsonb(kinds),'claimed',to_jsonb(claims));
end
$function$;

create or replace function public.claim_collection_reward(p_reward_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
 c uuid:=public.resolve_active_anonymous_chat_identity(); s jsonb; progress int:=0; target int:=1; award int:=0; rtype text; inserted_count int:=0; totalxp int:=0; distinctcount int:=0;
begin
 if c is null then raise exception 'Authentication required.'; end if;
 s:=public.get_my_collection_game_state();
 case p_reward_key
  when 'mission_first_egg' then progress:=(s->>'text_eggs')::int; target:=1; award:=40; rtype:='mission';
  when 'mission_today20' then progress:=(s->>'today_sent')::int; target:=20; award:=30; rtype:='mission';
  when 'mission_50' then progress:=(s->>'max_messages')::int; target:=50; award:=50; rtype:='mission';
  when 'mission_100' then progress:=(s->>'max_messages')::int; target:=100; award:=70; rtype:='mission';
  when 'mission_3eggs' then progress:=(s->>'distinct_eggs')::int; target:=3; award:=60; rtype:='mission';
  when 'mission_rare' then progress:=(s->>'distinct_eggs')::int; target:=1; award:=40; rtype:='mission';
  when 'mission_300' then progress:=(s->>'max_messages')::int; target:=300; award:=100; rtype:='mission';
  when 'mission_500' then progress:=(s->>'max_messages')::int; target:=500; award:=140; rtype:='mission';
  when 'mission_999' then progress:=(s->>'max_messages')::int; target:=999; award:=200; rtype:='mission';
  when 'mission_10000' then progress:=(s->>'max_messages')::int; target:=10000; award:=1000; rtype:='mission';
  when 'achievement_first_chat' then progress:=(s->>'sessions')::int; target:=1; award:=30; rtype:='achievement';
  when 'achievement_first_egg' then progress:=(s->>'distinct_eggs')::int; target:=1; award:=30; rtype:='achievement';
  when 'achievement_100' then progress:=(s->>'max_messages')::int; target:=100; award:=60; rtype:='achievement';
  when 'achievement_300' then progress:=(s->>'max_messages')::int; target:=300; award:=90; rtype:='achievement';
  when 'achievement_500' then progress:=(s->>'max_messages')::int; target:=500; award:=120; rtype:='achievement';
  when 'achievement_1000' then progress:=(s->>'max_messages')::int; target:=1000; award:=250; rtype:='achievement';
  when 'achievement_5eggs' then progress:=(s->>'distinct_eggs')::int; target:=5; award:=100; rtype:='achievement';
  when 'achievement_10eggs' then progress:=(s->>'distinct_eggs')::int; target:=10; award:=180; rtype:='achievement';
  when 'achievement_10000' then progress:=(s->>'max_messages')::int; target:=10000; award:=1200; rtype:='achievement';
  else raise exception 'Unknown reward.';
 end case;
 if progress<target then return jsonb_build_object('claimed',false,'reason','incomplete','progress',progress,'target',target); end if;
 insert into public.collection_reward_claims(user_id,reward_key,reward_type,xp_awarded) values(c,p_reward_key,rtype,award) on conflict do nothing;
 get diagnostics inserted_count = row_count;
 select coalesce(sum(xp_awarded),0)::int into totalxp from public.collection_reward_claims where user_id=c;
 select coalesce((public.get_my_collection_game_state()->>'distinct_eggs')::int,0) into distinctcount;
 totalxp:=totalxp+(distinctcount*100);
 return jsonb_build_object('claimed',true,'already_claimed',inserted_count=0,'xp_awarded',case when inserted_count=1 then award else 0 end,'xp',totalxp,'level',least(100,greatest(1,(totalxp/250)+1)));
end
$function$;
