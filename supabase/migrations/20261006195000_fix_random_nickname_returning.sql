-- Fix PL/pgSQL output-column ambiguity in random nickname rotation.
CREATE OR REPLACE FUNCTION public.rotate_my_anonymous_display_name()
RETURNS TABLE(status text, anonymous_display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_fixed uuid; v_name text; v_key text; v_current_key text; i int;
  v_verbs text[] := ARRAY['摸','偷','追','抱','吃','撿','躲','等','煮','寄','摘','騎','捲','踩','甩','揹'];
  v_objects text[] := ARRAY['魚','雲','星','雨','月','風','糖','夢','茶','瓜','光','雪','花','飯','霧','海'];
  v_chars text[] := ARRAY['企鵝','水獺','狐狸','海豹','白熊','鯨魚','兔子','松鼠','刺蝟','橘貓','黑貓','柴犬','河馬','章魚','樹懶','浣熊','鴨子','恐龍','海星','土豆','芒果','布丁','飯糰','奶茶','泡麵','雨傘','枕頭','月亮','星球','書包','電鍋','鬧鐘','沙發','鍵盤','滑鼠','耳機','書籤','便當','拖鞋','冰箱','地瓜','西瓜','葡萄','檸檬','蘋果','草莓','香蕉','海鹽','奶油','起司','吐司','蛋塔','餅乾','薯條','布偶','貓咪','狗狗','熊貓','海豚','烏龜','青蛙','蝸牛','蜜蜂','麻雀','海鷗','飛鼠','袋鼠','河狸','山羊','水母','螃蟹','書店','信箱','燈塔','島嶼','列車','唱片','相機','畫冊','飯盒','茶杯','窗簾','被子','氣球','飛船','月台','路燈','星塵','泡泡','烏雲','日落','宇宙','銀河','彩虹','流星'];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT fixed_profile_id INTO v_fixed FROM public.admin_fixed_anonymous_identities WHERE admin_user_id=v_actor;
  IF v_fixed IS NOT NULL AND v_fixed=v_actor THEN RETURN QUERY SELECT 'FIXED'::text,p.anonymous_display_name FROM public.profiles p WHERE p.id=v_actor; RETURN; END IF;
  SELECT p.anonymous_display_name_normalized INTO v_current_key FROM public.profiles AS p WHERE p.id=v_actor;
  FOR i IN 1..300 LOOP
    v_name := v_verbs[1+floor(random()*array_length(v_verbs,1))::int] || v_objects[1+floor(random()*array_length(v_objects,1))::int] || v_chars[1+floor(random()*array_length(v_chars,1))::int];
    v_key := lower(regexp_replace(trim(v_name),'[[:space:]]+',' ','g'));
    IF v_key = coalesce(v_current_key,'') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id<>v_actor AND p.anonymous_display_name_normalized=v_key) THEN
      BEGIN
        UPDATE public.profiles AS target_profile SET anonymous_display_name=v_name WHERE target_profile.id=v_actor RETURNING target_profile.anonymous_display_name INTO v_name;
        RETURN QUERY SELECT 'OK'::text,v_name; RETURN;
      EXCEPTION WHEN unique_violation THEN CONTINUE;
      END;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'RANDOM_NAME_UNAVAILABLE';
END
$function$;
REVOKE ALL ON FUNCTION public.rotate_my_anonymous_display_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_my_anonymous_display_name() TO authenticated;
