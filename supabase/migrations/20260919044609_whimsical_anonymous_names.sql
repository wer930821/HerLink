-- Three short phrase fragments give 32 * 32 * 32 combinations without digits.
-- Existing aliases are untouched; only future random rotations use this pool.
CREATE OR REPLACE FUNCTION public.rotate_my_anonymous_display_name()
RETURNS TABLE(status TEXT, anonymous_display_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  current_key TEXT;
  candidate TEXT;
  updated_name TEXT;
  moods CONSTANT TEXT[] := ARRAY[
    '摸魚的','失眠的','社恐的','暴走的','放空的','迷路的','遲到的','裝忙的',
    '發呆的','偷懶的','打嗝的','熬夜的','斷線的','冒泡的','飄走的','發光的',
    '害羞的','貪睡的','暴富的','沒電的','喝茶的','跳舞的','搖頭的','賴床的',
    '迷糊的','恍神的','路過的','逃跑的','開會的','打卡的','想睡的','發瘋的'
  ];
  characters CONSTANT TEXT[] := ARRAY[
    '企鵝','水獺','狐狸','海豹','白熊','鯨魚','兔子','松鼠',
    '刺蝟','橘貓','黑貓','柴犬','河馬','章魚','樹懶','浣熊',
    '鴨子','恐龍','海星','土豆','芒果','布丁','飯糰','奶茶',
    '泡麵','雨傘','枕頭','襪子','月亮','星球','書包','電鍋'
  ];
  actions CONSTANT TEXT[] := ARRAY[
    '偷吃雲','等公車','追泡麵','借月亮','躲鬧鐘','撿星星','找訊號','抱枕頭',
    '忘帶腦','開飛船','搶沙發','喝空氣','數地瓜','等放假','追地鐵','煮月亮',
    '偷午睡','逛宇宙','等外送','看冰箱','養烏雲','刷存在','裝訊號','躲星期一',
    '想下班','踩水坑','賣日落','學漂浮','偷吃飯','追影子','收集雨','抱地球'
  ];
  attempt INTEGER;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT profile.anonymous_display_name_normalized INTO current_key
  FROM public.profiles AS profile WHERE profile.id = actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  FOR attempt IN 1..48 LOOP
    candidate :=
      moods[1 + floor(random() * array_length(moods, 1))::INTEGER]
      || characters[1 + floor(random() * array_length(characters, 1))::INTEGER]
      || actions[1 + floor(random() * array_length(actions, 1))::INTEGER];
    IF lower(candidate) = current_key THEN
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.profiles AS profile
      SET anonymous_display_name = candidate
      WHERE profile.id = actor_id
      RETURNING profile.anonymous_display_name INTO updated_name;
      RETURN QUERY SELECT 'OK'::TEXT, updated_name;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;

  RAISE EXCEPTION 'RANDOM_NAME_UNAVAILABLE';
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_my_anonymous_display_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_my_anonymous_display_name() TO authenticated;
