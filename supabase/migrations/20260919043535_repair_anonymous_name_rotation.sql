-- The existing fixed name pool is exhausted. Preserve existing names, the
-- normalization trigger, the unique index, and the custom rename RPC.
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
  adjectives CONSTANT TEXT[] := ARRAY[
    '月光','晨霧','晚風','晴空','微雨','暖陽','森林','海岸',
    '雲朵','銀杏','琥珀','薄荷','奶油','焦糖','莓果','柚香',
    '靜夜','初雪','春日','夏末','秋色','冬陽','藍調','暮色'
  ];
  nouns CONSTANT TEXT[] := ARRAY[
    '企鵝','水獺','狐狸','海豹','白熊','鯨魚','兔子','松鼠',
    '刺蝟','橘貓','黑貓','柴犬','旅人','書店','信箱','燈塔',
    '島嶼','列車','唱片','相機','畫冊','茶杯','耳機','行星'
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
      adjectives[1 + floor(random() * array_length(adjectives, 1))::INTEGER]
      || nouns[1 + floor(random() * array_length(nouns, 1))::INTEGER]
      || lpad(floor(random() * 10000)::INTEGER::TEXT, 4, '0');
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
