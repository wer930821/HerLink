-- 匿名改名／換名必須改「有效聊天身分」，而不是登入用的 auth id。
--
-- 問題：set_my_anonymous_display_name 與 rotate_my_anonymous_display_name
-- 一律用 auth.uid() 當 actor。接回身分的使用者，聊天身分 id 跟登入用
-- 的 auth id 是分開的（靠 anonymous_identity_device_state 綁定），結果：
-- 1. 改名／換名改到登入用的那筆 profiles，真正的聊天身分那筆名字
--    沒變，首頁仍顯示舊名字或預設的「匿名使用者」；
-- 2. NAME_TAKEN 檢查只排除 auth id，不排除有效身分，導致接回的使用者
--    改回自己原本的名字時，被自己舊身分那筆擋下，誤報「有人使用」。
--    （望海藍天案：新身分想改回望海藍天，舊身分那筆仍佔著這個名字。）
--
-- 修法：兩支 function 的 actor 改用
-- COALESCE(resolve_active_anonymous_chat_identity(), auth.uid()) 的有效身分，
-- 但保留管理員固定身分的原有行為（admin_fixed_anonymous_identities 檢查
-- 仍以登入 auth id 為準，固定身分不受影響）。
--
-- 注意：resolve 回傳 NULL 代表目前沒有可用的有效身分（例如該 auth id
-- 本身已是被別人接走的舊身分），此時不應退回改 auth 那筆，否則會動到
-- 別人的身分；直接報 Authentication required，與原本無 profiles 列時
-- 改名失敗的結果一致（用戶端顯示網路連線失敗，不會誤報 NAME_TAKEN）。
--
-- 此 migration 只改改名／換名邏輯，不搬任何名字、不清任何身分。
-- 望海藍天案的正確後續仍是把舊身分接回來，不是靠改名把名字搶回來；
-- 本修法是讓接回身分後的使用者改名不再改錯筆、不再被自己舊名字擋下。

CREATE OR REPLACE FUNCTION public.set_my_anonymous_display_name(p_name text)
RETURNS TABLE(status text, anonymous_display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_identity uuid;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_name_key text := lower(v_name);
  v_fixed uuid;
  v_updated text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT afi.fixed_profile_id
  INTO v_fixed
  FROM public.admin_fixed_anonymous_identities AS afi
  WHERE afi.admin_user_id = v_actor;

  IF v_fixed IS NOT NULL AND v_fixed = v_actor THEN
    RETURN QUERY
    SELECT 'FIXED'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_actor;
    RETURN;
  END IF;

  v_identity := public.resolve_active_anonymous_chat_identity();
  IF v_identity IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_name = '' OR char_length(v_name) < 2 THEN RAISE EXCEPTION 'TOO_SHORT'; END IF;
  IF char_length(v_name) > 12 THEN RAISE EXCEPTION 'TOO_LONG'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id <> v_identity
      AND lower(regexp_replace(trim(coalesce(p.anonymous_display_name, '')), '[[:space:]]+', ' ', 'g')) = v_name_key
  ) THEN
    RETURN QUERY
    SELECT 'NAME_TAKEN'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_identity;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.profiles AS target_profile
    SET anonymous_display_name = v_name
    WHERE target_profile.id = v_identity
    RETURNING target_profile.anonymous_display_name INTO v_updated;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY
    SELECT 'NAME_TAKEN'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_identity;
    RETURN;
  END;

  RETURN QUERY SELECT 'OK'::text, v_updated;
END
$function$;

REVOKE ALL ON FUNCTION public.set_my_anonymous_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_anonymous_display_name(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rotate_my_anonymous_display_name()
RETURNS TABLE(status text, anonymous_display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_identity uuid;
  v_fixed uuid;
  v_name text;
  v_key text;
  v_current_key text;
  i int;
  v_verbs text[] := ARRAY['摸','偷','追','抱','吃','撿','躲','等','煮','寄','摘','騎','捲','踩','甩','揹'];
  v_objects text[] := ARRAY['魚','雲','星','雨','月','風','糖','夢','茶','瓜','光','雪','花','飯','霧','海'];
  v_chars text[] := ARRAY['企鵝','水獺','狐狸','海豹','白熊','鯨魚','兔子','松鼠','刺蝟','橘貓','黑貓','柴犬','河馬','章魚','樹懶','浣熊','鴨子','恐龍','海星','土豆','芒果','布丁','飯糰','奶茶','泡麵','雨傘','枕頭','月亮','星球','書包','電鍋','鬧鐘','沙發','鍵盤','滑鼠','耳機','書籤','便當','拖鞋','冰箱','地瓜','西瓜','葡萄','檸檬','蘋果','草莓','香蕉','海鹽','奶油','起司','吐司','蛋塔','餅乾','薯條','布偶','貓咪','狗狗','熊貓','海豚','烏龜','青蛙','蝸牛','蜜蜂','麻雀','海鷗','飛鼠','袋鼠','河狸','山羊','水母','螃蟹','書店','信箱','燈塔','島嶼','列車','唱片','相機','畫冊','飯盒','茶杯','窗簾','被子','氣球','飛船','月台','路燈','星塵','泡泡','烏雲','日落','宇宙','銀河','彩虹','流星'];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT fixed_profile_id INTO v_fixed FROM public.admin_fixed_anonymous_identities WHERE admin_user_id = v_actor;
  IF v_fixed IS NOT NULL AND v_fixed = v_actor THEN
    RETURN QUERY SELECT 'FIXED'::text, p.anonymous_display_name FROM public.profiles p WHERE p.id = v_actor; RETURN;
  END IF;
  v_identity := public.resolve_active_anonymous_chat_identity();
  IF v_identity IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT anonymous_display_name_normalized INTO v_current_key FROM public.profiles WHERE id = v_identity;
  FOR i IN 1..300 LOOP
    v_name := v_verbs[1+floor(random()*array_length(v_verbs,1))::int] || v_objects[1+floor(random()*array_length(v_objects,1))::int] || v_chars[1+floor(random()*array_length(v_chars,1))::int];
    v_key := lower(regexp_replace(trim(v_name),'[[:space:]]+',' ','g'));
    IF v_key = coalesce(v_current_key,'') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id <> v_identity AND p.anonymous_display_name_normalized = v_key) THEN
      BEGIN
        UPDATE public.profiles SET anonymous_display_name = v_name WHERE id = v_identity RETURNING anonymous_display_name INTO v_name;
        RETURN QUERY SELECT 'OK'::text, v_name; RETURN;
      EXCEPTION WHEN unique_violation THEN CONTINUE;
      END;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'RANDOM_NAME_UNAVAILABLE';
END
$function$;

REVOKE ALL ON FUNCTION public.rotate_my_anonymous_display_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_my_anonymous_display_name() TO authenticated;
