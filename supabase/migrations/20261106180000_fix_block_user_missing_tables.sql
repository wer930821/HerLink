-- 修正封鎖功能：block_user 參照了不存在的表，導致每次封鎖都失敗。
--
-- 根因（2026-11-06 實測＋查證）：
--   2026-09-22 的 migration 20260922224500_remove_legacy_dating_system.sql
--   已把舊交友系統的 likes、matches 兩張表刪掉，但之後
--   20261006180000_recovered_chat_identity_access.sql 重新定義 block_user 時，
--   又把「DELETE FROM public.likes」和「UPDATE public.matches」這兩句抄回來。
--   正式資料庫根本沒有這兩張表，所以每次按封鎖，函式跑到這兩句就報
--   relation "likes" does not exist（42P01），整個交易回滾，blocks 永遠寫不進去。
--   實測：孤星企鵝、摸夢河狸兩邊按封鎖都只跳「目前無法封鎖這位使用者」。
--
-- 修法：拿掉那兩句。隨機聊天不用 likes／matches（配對與結束走
-- random_chat_sessions，block_random_user 會自己把聊天室設為 ended），
-- 所以 active_match_blocked 固定回 FALSE。其餘邏輯（寫 blocks、記裝置、
-- 限流、風險事件）全部不動。

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

  -- 沒有 matches 表了（舊交友系統已移除），active_match_blocked 固定 FALSE；
  -- 聊天室的結束由 block_random_user 負責。
  RETURN QUERY SELECT TRUE, FALSE;
END;
$$;
