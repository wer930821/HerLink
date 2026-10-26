-- 新配對一直導回既有聊天室修法（#126 的副作用）。
--
-- 問題：#126 為了修第一等待者卡住，在 join_random_match_internal 開頭
-- 加了「佇列已是 matched 且 session 還在 active，就直接回舊 session」。
-- 但佇列是每人只有一列，進聊天室之後那列 matched 從來沒有被清掉
-- （leave_random_queue 只清 waiting，不動 matched；只有離開聊天室才清）。
-- 所以使用者下次從首頁按「新配對」，第一次呼叫 find_or_join 就立刻
-- 命中舊 matched，直接被導回舊聊天室，根本沒機會進等待、配新人。
-- 即使他還有配對欄位（上限 3 個、目前只有 2 個），也配不到第 3 個。
--
-- 修法：區分「明確要配新人」跟「輪詢等配對結果」。
-- - find_or_join_random_match 新增 p_new_match（預設 false，相容舊客戶端）。
-- - join_random_match_internal 新增 p_new_match（預設 false）。
-- - 只有 p_new_match = false（輪詢）時，才走 #126 的舊 matched 直接回傳，
--   第一等待者不會又卡住。
-- - p_new_match = true（首頁按新配對的第一下）時，跳過舊 matched 回傳，
--   照舊把佇列重設成 waiting 去找新候選人，舊 matched 就被蓋掉了。
-- - 網站等待頁不走 find_or_join、只讀佇列，但它下次從首頁按新配對時
--   同樣會帶 p_new_match = true，所以網站版也一併修好。
-- - 舊版 App／網站不帶參數時預設 false，行為跟 #126 之後一樣，不會
--   因為 migration 先上線、新版還沒發佈就整個配對壞掉；新版 App 則在
--   伺服器還沒執行這支 migration 時，會自動退回不帶參數的呼叫（見
--   lib/random-chat.ts 的 fallback），配對不會直接報錯，只是舊 bug
--   要等 migration 執行後才真正修好。
--
-- 注意：先 DROP 舊簽名再建新簽名，避免同名函數重載讓 PostgREST
-- 無法選函數（之前 push_token PGRST203 的教訓）。
DROP FUNCTION IF EXISTS public.find_or_join_random_match();
DROP FUNCTION IF EXISTS public.join_random_match_internal(UUID, UUID);

CREATE OR REPLACE FUNCTION public.join_random_match_internal(
  p_actor_id UUID,
  p_excluded_user_id UUID DEFAULT NULL,
  p_new_match BOOLEAN DEFAULT FALSE
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

  -- 輪詢時才回舊 matched：第一等待者就是靠這段進聊天室。
  -- 明確要配新人時跳過這段，否則永遠導回舊聊天室。
  IF NOT COALESCE(p_new_match, FALSE) THEN
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

CREATE OR REPLACE FUNCTION public.find_or_join_random_match(
  p_new_match BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (status TEXT, session_id UUID, matched_user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
  active_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.matchmaking', 0));
  SELECT count(*) INTO active_count
  FROM public.random_chat_sessions s
  WHERE s.status='active' AND (s.user_a=actor_id OR s.user_b=actor_id);
  IF active_count>=3 THEN
    RETURN QUERY SELECT 'limit_reached'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.join_random_match_internal(actor_id, NULL, p_new_match);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.join_random_match_internal(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_or_join_random_match(BOOLEAN) TO authenticated, service_role;
