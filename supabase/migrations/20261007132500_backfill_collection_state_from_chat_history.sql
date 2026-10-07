create or replace function public.record_chat_easter_egg_event(
  p_session_id uuid, p_egg_kind text, p_trigger_type text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  event_id uuid;
  ua uuid;
  ub uuid;
begin
  if auth.uid() is null or actor_id is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if coalesce(trim(p_egg_kind),'')='' then raise exception 'Missing egg kind' using errcode='22023'; end if;
  if p_trigger_type not in ('text','milestone') then raise exception 'Invalid trigger type' using errcode='22023'; end if;

  select s.user_a, s.user_b into ua, ub
  from public.random_chat_sessions s
  where s.id=p_session_id and (s.user_a=actor_id or s.user_b=actor_id);
  if not found then
    raise exception 'Current identity is not this chat participant' using errcode='P0001';
  end if;

  if p_egg_kind='thousand' then
    insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
    values(p_session_id,actor_id,p_egg_kind,p_trigger_type)
    on conflict (session_id) where egg_kind='thousand' do nothing
    returning id into event_id;

    if event_id is null then
      select id into event_id
      from public.chat_easter_egg_events
      where session_id=p_session_id and egg_kind='thousand'
      limit 1;
    end if;

    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(event_id,p_session_id,ua)
    on conflict(event_id,user_id) do nothing;
    insert into public.chat_easter_egg_deliveries(event_id,session_id,user_id)
    values(event_id,p_session_id,ub)
    on conflict(event_id,user_id) do nothing;
  else
    insert into public.chat_easter_egg_events(session_id,user_id,egg_kind,trigger_type)
    values(p_session_id,actor_id,p_egg_kind,p_trigger_type)
    returning id into event_id;
  end if;

  return event_id;
end
$function$;

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
   union
   select p.kind
   from public.random_chat_messages m
   join (values
     ('sync','今天也遇見你了|今天又遇見你了|今天也遇見妳了|今天又遇見妳了|笑死'),
     ('afternoon','午安'),
     ('heyhey','嗨嗨'),
     ('hello_you','你好呀|你好啊'),
     ('meal','吃飯了嗎|吃飯沒|吃了嗎'),
     ('haha','哈哈哈|笑死'),
     ('hardwork','辛苦了'),
     ('missyou','想你了|想妳了|好想你|好想妳'),
     ('coincidence','好巧|這麼巧'),
     ('meet_again','又遇到你了|又遇到妳了'),
     ('secret_word','秘密'),
     ('moon','月亮'),
     ('stars','星星'),
     ('destiny','命中注定'),
     ('telepathy','心有靈犀'),
     ('no_goodbye','不想說再見|捨不得說再見'),
     ('sleepless','睡不著'),
     ('aurora','想你|想妳|想念|好想|想你了|想妳了'),
     ('tired','好累|累死|累爆|累慘'),
     ('offwork','下班了|下班啦|終於下班'),
     ('meteor','加油|祝你|祝妳|希望|順利|辛苦了'),
     ('cute','好可愛|可愛死|太可愛'),
     ('secret','喜歡你|喜歡妳|喜歡|心動|愛你|愛妳'),
     ('morning','早安|早啊|早呀|早上好'),
     ('hi','^(hi|hey|hello)$'),
     ('hello','安安|嗨嗨|哈囉|哈啰'),
     ('tomorrow','明天見'),
     ('goodnight','晚安|先睡了|我要睡了'),
     ('penguin','企鵝'),
     ('food','吃飯了嗎|吃飽了嗎|吃飯沒|吃了嗎|吃什麼'),
     ('curious','在幹嘛|在幹麻|幹嘛呢|在做什麼'),
     ('surprised','真的假的|真的嗎|不會吧|蛤真的')
   ) as p(kind,pattern) on regexp_replace(coalesce(m.content,''),'\s+','','g') ~* p.pattern
   where m.sender_id=c
   union
   select case when extract(hour from m.created_at at time zone 'Asia/Taipei')=3 then 'threeam' else 'midnight' end
   from public.random_chat_messages m
   where m.sender_id=c and extract(hour from m.created_at at time zone 'Asia/Taipei') >= 0 and extract(hour from m.created_at at time zone 'Asia/Taipei') < 5
   union
   select 'weekend'
   from public.random_chat_messages m
   where m.sender_id=c and extract(dow from m.created_at at time zone 'Asia/Taipei') in (0,6)
   union
   select v.kind
   from (
     select count(*) cnt
     from public.random_chat_messages m
     join public.random_chat_sessions s on s.id=m.session_id
     where s.user_a=c or s.user_b=c
     group by m.session_id
   ) sc
   join (values
     (50,'fifty'),(100,'hundred'),(200,'twoHundred'),(300,'threeHundred'),(400,'fourHundred'),
     (500,'fiveHundred'),(600,'sixHundred'),(700,'sevenHundred'),(800,'eightHundred'),(900,'nineHundred'),
     (1000,'thousand'),(1500,'fifteenHundred'),(2000,'twoThousand'),(3000,'threeThousand'),
     (5000,'fiveThousand'),(10000,'tenThousand')
   ) as v(threshold,kind) on sc.cnt >= v.threshold
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
   union
   select p.kind
   from public.random_chat_messages m
   join (values
     ('sync','今天也遇見你了|今天又遇見你了|今天也遇見妳了|今天又遇見妳了|笑死'),
     ('afternoon','午安'),('heyhey','嗨嗨'),('hello_you','你好呀|你好啊'),
     ('meal','吃飯了嗎|吃飯沒|吃了嗎'),('haha','哈哈哈|笑死'),('hardwork','辛苦了'),
     ('missyou','想你了|想妳了|好想你|好想妳'),('coincidence','好巧|這麼巧'),
     ('meet_again','又遇到你了|又遇到妳了'),('secret_word','秘密'),('moon','月亮'),('stars','星星'),
     ('destiny','命中注定'),('telepathy','心有靈犀'),('no_goodbye','不想說再見|捨不得說再見'),
     ('sleepless','睡不著'),('aurora','想你|想妳|想念|好想|想你了|想妳了'),
     ('tired','好累|累死|累爆|累慘'),('offwork','下班了|下班啦|終於下班'),
     ('meteor','加油|祝你|祝妳|希望|順利|辛苦了'),('cute','好可愛|可愛死|太可愛'),
     ('secret','喜歡你|喜歡妳|喜歡|心動|愛你|愛妳'),('morning','早安|早啊|早呀|早上好'),
     ('hi','^(hi|hey|hello)$'),('hello','安安|嗨嗨|哈囉|哈啰'),('tomorrow','明天見'),
     ('goodnight','晚安|先睡了|我要睡了'),('penguin','企鵝'),
     ('food','吃飯了嗎|吃飽了嗎|吃飯沒|吃了嗎|吃什麼'),('curious','在幹嘛|在幹麻|幹嘛呢|在做什麼'),
     ('surprised','真的假的|真的嗎|不會吧|蛤真的')
   ) as p(kind,pattern) on regexp_replace(coalesce(m.content,''),'\s+','','g') ~* p.pattern
   where m.sender_id=c
   union
   select case when extract(hour from m.created_at at time zone 'Asia/Taipei')=3 then 'threeam' else 'midnight' end
   from public.random_chat_messages m
   where m.sender_id=c and extract(hour from m.created_at at time zone 'Asia/Taipei') >= 0 and extract(hour from m.created_at at time zone 'Asia/Taipei') < 5
   union
   select 'weekend'
   from public.random_chat_messages m
   where m.sender_id=c and extract(dow from m.created_at at time zone 'Asia/Taipei') in (0,6)
 ) z;
 distinctcount:=coalesce(array_length(kinds,1),0);
 egg_xp:=distinctcount*100;
 xp:=egg_xp+reward_xp;
 lvl:=least(100,greatest(1,(xp/250)+1));
 return jsonb_build_object('xp',xp,'level',lvl,'level_xp',case when lvl>=100 then 0 else xp%250 end,'next_level_xp',case when lvl>=100 then 0 else 250 end,'today_sent',today_count,'sent_total',sent,'sessions',sess,'max_messages',maxmsg,'distinct_eggs',distinctcount,'text_eggs',textcount,'egg_kinds',to_jsonb(kinds),'claimed',to_jsonb(claims));
end
$function$;
