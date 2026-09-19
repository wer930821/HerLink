-- A one-character verb, one-character object and two-character character
-- produce 16 * 16 * 96 = 24,576 four-character names without digits.
-- Existing aliases and the custom rename RPC remain unchanged.
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
  verbs CONSTANT TEXT[] := ARRAY[
    '摸','偷','追','抱','吃','撿','躲','等',
    '煮','寄','摘','騎','捲','踩','甩','揹'
  ];
  objects CONSTANT TEXT[] := ARRAY[
    '魚','雲','星','雨','月','風','糖','夢',
    '茶','瓜','光','雪','花','飯','霧','海'
  ];
  characters CONSTANT TEXT[] := ARRAY[
    '企鵝','水獺','狐狸','海豹','白熊','鯨魚','兔子','松鼠',
    '刺蝟','橘貓','黑貓','柴犬','河馬','章魚','樹懶','浣熊',
    '鴨子','恐龍','海星','土豆','芒果','布丁','飯糰','奶茶',
    '泡麵','雨傘','枕頭','襪子','月亮','星球','書包','電鍋',
    '鬧鐘','沙發','鍵盤','滑鼠','耳機','書籤','便當','拖鞋',
    '冰箱','地瓜','西瓜','葡萄','檸檬','蘋果','草莓','香蕉',
    '海鹽','奶油','起司','吐司','蛋塔','餅乾','薯條','布偶',
    '貓咪','狗狗','熊貓','海豚','烏龜','青蛙','蝸牛','蜜蜂',
    '麻雀','海鷗','飛鼠','袋鼠','河狸','山羊','水母','螃蟹',
    '書店','信箱','燈塔','島嶼','列車','唱片','相機','畫冊',
    '飯盒','茶杯','窗簾','被子','氣球','飛船','月台','路燈',
    '星塵','泡泡','烏雲','日落','宇宙','銀河','彩虹','流星'
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
      verbs[1 + floor(random() * array_length(verbs, 1))::INTEGER]
      || objects[1 + floor(random() * array_length(objects, 1))::INTEGER]
      || characters[1 + floor(random() * array_length(characters, 1))::INTEGER]
      ;
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
