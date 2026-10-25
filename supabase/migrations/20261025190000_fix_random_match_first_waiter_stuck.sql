-- 隨機配對第一個等待者永遠進不了聊天室修法。
--
-- 問題：join_random_match_internal 每一次被呼叫，一開始就把自己的
-- 佇列列無條件重設成 waiting、matched_session_id = NULL，然後才去找
-- 候選人。第二個加入者配對成功時，會把兩邊佇列都改成 matched 並建
-- 好聊天室，第二個人當場拿到 matched 直接進聊天室；但第一個人每 5 秒
-- 輪詢一次 find_or_join，輪詢一來就先把自己剛被改成的 matched 蓋回
-- waiting、session_id 清掉，之後又找不到新的等待者（第二個人已經不
-- 在等待中了），就永遠回 waiting，App 就一直卡在「正在尋找聊天對象…」。
-- 原生 App 只輪詢 find_or_join、沒有用 get_my_random_queue，所以第一
-- 個等待者一定會遇到這個問題，網站版因為有另外查佇列才比較不容易看到。
--
-- 修法：join_random_match_internal 一開始先查自己佇列，如果已經是
-- matched 且那個 session 還在 active，就直接回 matched（session_id
-- 與對方 id），不要重設成 waiting；只有在沒有有效 matched session
-- 時，才照舊重設成 waiting 去找新候選人。App 不用等新版，伺服器
-- 修法生效後輪詢就會拿到 matched 進聊天室。
CREATE OR REPLACE FUNCTION public.join_random_match_internal(
  p_actor_id UUID,
  p_excluded_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  status TEXT,
  session_id UUID,
  matched_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_profile RECORD;
  candidate_user_id UUID;
  session_uuid UUID;
  existing_session_id UUID;
  existing_matched_user_id UUID;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);

  SELECT profile.account_status, profile.anonymous_mode_enabled,
         profile.anonymous_display_name, profile.anonymous_avatar
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF actor_profile.account_status <> 'active' THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;
  IF NOT COALESCE(actor_profile.anonymous_mode_enabled, FALSE) THEN RAISE EXCEPTION 'Anonymous mode is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_display_name, '')) = '' THEN RAISE EXCEPTION 'Anonymous display name is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_avatar, '')) = '' THEN RAISE EXCEPTION 'Anonymous avatar is required.'; END IF;

  -- 已經被配對成功、session 還在 active：直接回 matched，不要重設。
  SELECT q.matched_session_id, CASE WHEN s.user_a = p_actor_id THEN s.user_b ELSE s.user_a END
  INTO existing_session_id, existing_matched_user_id
  FROM public.random_match_queue AS q
  JOIN public.random_chat_sessions AS s ON s.id = q.matched_session_id
  WHERE q.user_id = p_actor_id
    AND q.status = 'matched'
    AND q.matched_session_id IS NOT NULL
    AND s.status = 'active'
    AND (p_excluded_user_id IS NULL OR (CASE WHEN s.user_a = p_actor_id THEN s.user_b ELSE s.user_a END) <> p_excluded_user_id);
  IF FOUND THEN
    RETURN QUERY SELECT 'matched'::TEXT, existing_session_id, existing_matched_user_id;
    RETURN;
  END IF;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET status = EXCLUDED.status, joined_at = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at, matched_session_id = NULL;

  SELECT q.user_id
  INTO candidate_user_id
  FROM public.random_match_queue AS q
  JOIN public.profiles AS candidate ON candidate.id = q.user_id
  WHERE q.status = 'waiting'
    AND q.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR q.user_id <> p_excluded_user_id)
    AND candidate.account_status = 'active'
    AND COALESCE(candidate.anonymous_mode_enabled, FALSE) = TRUE
    AND btrim(COALESCE(candidate.anonymous_display_name, '')) <> ''
    AND btrim(COALESCE(candidate.anonymous_avatar, '')) <> ''
    AND NOT public.has_block_between(p_actor_id, q.user_id)
    AND (SELECT count(*) FROM public.random_chat_sessions s
         WHERE s.status='active' AND (s.user_a=q.user_id OR s.user_b=q.user_id)) < 3
    AND NOT EXISTS (
      SELECT 1 FROM public.random_chat_sessions s
      WHERE s.status='active'
        AND ((s.user_a=p_actor_id AND s.user_b=q.user_id)
          OR (s.user_b=p_actor_id AND s.user_a=q.user_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.random_pair_history h
      WHERE h.pair_key=public.random_pair_key(p_actor_id,q.user_id)
        AND h.matched_at >= timezone('utc'::text,now()) - INTERVAL '24 hours'
    )
  ORDER BY q.joined_at ASC, q.user_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();
    INSERT INTO public.random_chat_sessions(id,user_a,user_b,status,created_at)
    VALUES(session_uuid,LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),'active',timezone('utc'::text,now()));

    INSERT INTO public.random_pair_history(pair_key,user_a,user_b,matched_at)
    VALUES(public.random_pair_key(p_actor_id,candidate_user_id),LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),timezone('utc'::text,now()));

    UPDATE public.random_match_queue
    SET status='matched',updated_at=timezone('utc'::text,now()),matched_session_id=session_uuid
    WHERE user_id IN(p_actor_id,candidate_user_id);

    RETURN QUERY SELECT 'matched'::TEXT,session_uuid,candidate_user_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'waiting'::TEXT,NULL::UUID,NULL::UUID;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_random_match_internal(UUID, UUID) TO authenticated, service_role;
