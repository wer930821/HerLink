-- 封鎖改進：A＋B＋C（2026-11-06，站長信箱「撿月星球」案）。
--
-- 背景：使用者反應一直重複配對到同一個人，封鎖了還是配對到。
-- 查證結果：封鎖本身沒壞（配對會排除已封鎖的身分），但封鎖只認身分
-- UUID；對方刪資料換新身分就繞過。撿月星球的身分是當天新建的，
-- 封鎖紀錄 0 筆，之前身分查不到（網頁版不登記裝置、無改名紀錄、
-- 無恢復碼、信箱無舊信）。
--
-- 本 migration 做三件事：
-- A. 不重複配對窗口 24 小時 → 7 天（join_random_match_internal）。
-- B. 新增 list_my_recent_random_sessions：列出 7 天內已結束的聊天室
--    （含對方身分 UUID），讓 App／網頁在聊天室列表補「結束後也能封鎖」。
-- C. 裝置封鎖：新增 blocked_devices 表；block_user 封鎖某人時，一併把
--    對方已登記的裝置記下來；配對時排除裝置也被封鎖的候選人。
--    注意：裝置碼只在 App 登入時登記（lib/device.ts）；網頁版本次
--    一併補登記（apps/web/lib/device.ts），否則網頁用戶封不到裝置。
--    限制：重裝 App 或清掉瀏覽器資料會產生新裝置碼，裝置封鎖也會
--    被繞過；匿名制下沒有 100% 擋得住的方法，這三層只是讓重複配對
--    變得很難、很少發生。
--
-- 執行方式：請站長在 Supabase SQL Editor 執行本檔案（正式 DB 的
-- migration 一律由站長執行，Muse 不直接改正式 DB）。

-- ================= C-1. blocked_devices 表 =================

CREATE TABLE IF NOT EXISTS public.blocked_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  blocked_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT blocked_devices_unique_pair UNIQUE (blocker_id, device_hash)
);

CREATE INDEX IF NOT EXISTS blocked_devices_blocker_id_idx
  ON public.blocked_devices (blocker_id);
CREATE INDEX IF NOT EXISTS blocked_devices_device_hash_idx
  ON public.blocked_devices (device_hash);

ALTER TABLE public.blocked_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own blocked devices"
  ON public.blocked_devices;
CREATE POLICY "Users can see their own blocked devices"
  ON public.blocked_devices
  FOR SELECT
  USING (auth.uid() = blocker_id);

GRANT SELECT ON public.blocked_devices TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_devices TO service_role;

-- ================= C-2. block_user：封鎖時一併記裝置 =================
-- 基準：20261006180000_recovered_chat_identity_access.sql 的版本
-- （resolve_active_anonymous_chat_identity、20 次／小時限流、2 次
-- 被封鎖觸發 risk event），只加一段裝置記錄，其餘行為不變。
-- block_random_user 會呼叫 block_user，所以聊天室內封鎖也自動記裝置。

CREATE OR REPLACE FUNCTION public.block_user(target_user_id UUID)
RETURNS TABLE (
  blocked BOOLEAN,
  active_match_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
  created_block_id UUID;
  block_count INTEGER := 0;
  updated_rows INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or device revoked.';
  END IF;

  PERFORM public.assert_rate_limit(
    'block_user',
    20,
    3600,
    jsonb_build_object('target_user_id', target_user_id)
  );

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot block yourself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user was not found.';
  END IF;

  INSERT INTO public.blocks (blocker_id, blocked_user_id)
  VALUES (actor_id, target_user_id)
  ON CONFLICT (blocker_id, blocked_user_id) DO NOTHING
  RETURNING id INTO created_block_id;

  -- 裝置封鎖：把對方已登記的裝置一併記下來，對方換身分也配對不到。
  -- 對方若沒有裝置紀錄（例如網頁版尚未登記），這段就不記任何東西，
  -- 身分封鎖本身不受影響。
  INSERT INTO public.blocked_devices (blocker_id, device_hash, blocked_user_id)
  SELECT actor_id, d.device_hash, target_user_id
  FROM public.devices d
  WHERE d.user_id = target_user_id
  ON CONFLICT (blocker_id, device_hash) DO NOTHING;

  DELETE FROM public.likes
  WHERE (from_user_id = actor_id AND to_user_id = target_user_id)
     OR (from_user_id = target_user_id AND to_user_id = actor_id);

  UPDATE public.matches
  SET status = 'blocked'
  WHERE status = 'active'
    AND user_1_id = LEAST(actor_id, target_user_id)
    AND user_2_id = GREATEST(actor_id, target_user_id);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  SELECT COUNT(*) INTO block_count
  FROM public.blocks
  WHERE blocked_user_id = target_user_id;

  IF block_count = 2 THEN
    PERFORM public.apply_risk_event(
      target_user_id,
      'multiple_blocks_received',
      jsonb_build_object('block_count', block_count, 'triggered_by', actor_id)
    );
  END IF;

  RETURN QUERY SELECT TRUE, updated_rows > 0;
END;
$$;

-- ================= A＋C-3. 配對：7 天不重配＋排除裝置被封者 =================
-- 基準：20261026170000_fix_new_match_returns_old_matched.sql 的
-- join_random_match_internal，只改兩處：
-- 1) random_pair_history 窗口 INTERVAL '24 hours' → INTERVAL '7 days'。
-- 2) 候選人排除條件加一段：候選人的任一裝置在封鎖清單上就排除。
-- find_or_join_random_match 簽名不變，不用重建。

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
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_devices bd
      JOIN public.devices d ON d.device_hash = bd.device_hash
      WHERE bd.blocker_id = p_actor_id AND d.user_id = q.user_id
    )
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
        AND h.matched_at >= timezone('utc'::text,now()) - INTERVAL '7 days'
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

-- ================= B. 最近已結束聊天室（供「結束後封鎖」用） =================
-- 列出 7 天內已結束的隨機聊天室（最近結束的在前，最多 50 筆），
-- 含對方身分 UUID，讓 App／網頁在聊天室列表對已結束的對話顯示
-- 「封鎖對方」，呼叫既有的 block_random_user(session_id) 即可
-- （該 RPC 不限聊天室狀態，結束後也能封鎖）。
-- 已封鎖的對方不再列出；封鎖成功後 App／網頁把該列移除。

CREATE OR REPLACE FUNCTION public.list_my_recent_random_sessions(p_days INTEGER DEFAULT 7)
RETURNS TABLE(
  id UUID,
  status TEXT,
  created_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  ended_by_me BOOLEAN,
  partner_user_id UUID,
  partner_anonymous_display_name TEXT,
  partner_anonymous_avatar TEXT,
  partner_verified BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH actor AS (SELECT public.resolve_active_anonymous_chat_identity() AS id)
  SELECT
    s.id,
    s.status,
    s.created_at,
    s.ended_at,
    s.ended_reason,
    s.ended_by = actor.id,
    CASE WHEN s.user_a = actor.id THEN s.user_b ELSE s.user_a END,
    COALESCE(partner.anonymous_display_name, '匿名使用者'),
    COALESCE(partner.anonymous_avatar, 'avatar_01'),
    COALESCE(partner.verified, FALSE)
  FROM actor
  JOIN public.random_chat_sessions s
    ON actor.id IS NOT NULL
   AND s.status = 'ended'
   AND s.ended_at >= timezone('utc'::text, now())
     - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 7), 1), 30))
   AND (s.user_a = actor.id OR s.user_b = actor.id)
   AND NOT public.has_block_between(
     actor.id,
     CASE WHEN s.user_a = actor.id THEN s.user_b ELSE s.user_a END
   )
  LEFT JOIN LATERAL (
    SELECT * FROM public.get_safe_anonymous_profiles(
      ARRAY[CASE WHEN s.user_a = actor.id THEN s.user_b ELSE s.user_a END]
    ) LIMIT 1
  ) partner ON TRUE
  ORDER BY s.ended_at DESC, s.id DESC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.join_random_match_internal(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_recent_random_sessions(INTEGER) TO authenticated, service_role;
