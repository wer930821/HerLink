-- 聊天室列表未讀提醒 + 其他聊天室新訊息提醒。
--
-- 問題：聊天室列表只顯示對方名字和建立日期，沒有未讀數、也沒有最後一句
-- 訊息。首頁雖然有總未讀數，但同時有 3 間聊天室時，進列表還是看不出
-- 是哪一間有新訊息，只能一間一間點開看；人在某一間聊天室裡時，也
-- 不會知道另一間來了新訊息。
--
-- 修法：list_my_active_random_sessions() 加 5 個欄位，舊客戶端忽略
-- 多出來的欄位不會壞，新版 App 有欄位就顯示、沒有欄位就維持舊樣子，
-- 所以 migration 先上線或 App 先上線都不會把聊天室列表打壞。
-- - unread_count：對方寄出、還沒被我讀過的訊息數。讀取時間用
--   random_chat_session_reads（mark_random_session_read 寫入、已改用
--   有效身分），沒有讀取紀錄時以聊天室建立時間為準；已收回的訊息不算。
-- - last_message_preview：最後一則訊息的預覽，圖片顯示「傳送了一張照片」，
--   文字取前 80 字、換行壓成空格，已收回顯示「此訊息已收回」。
-- - last_message_at / last_message_type / last_message_is_mine：最後一則
--   的時間、類型、是不是我寄的，供列表排序和顯示用。
-- - 排序：有未讀的先排前面，再照最後訊息時間倒序、最後照建立時間倒序。
--   這樣要回的那一間會浮在最上面。
--
-- 注意：這個 migration 只改列表查詢，不改推播、不改已讀寫入邏輯，
-- 也不動正式資料。使用者須在 Supabase SQL Editor 執行後才生效；
-- 執行前新版 App 只會看不到未讀數，不會報錯。

DROP FUNCTION IF EXISTS public.list_my_active_random_sessions();

CREATE OR REPLACE FUNCTION public.list_my_active_random_sessions()
RETURNS TABLE(
  id UUID,
  status TEXT,
  created_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  ended_by_me BOOLEAN,
  partner_anonymous_display_name TEXT,
  partner_anonymous_avatar TEXT,
  partner_verified BOOLEAN,
  partner_age_display TEXT,
  partner_city TEXT,
  unread_count BIGINT,
  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_type TEXT,
  last_message_is_mine BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH actor AS (SELECT public.resolve_active_anonymous_chat_identity() AS id)
  SELECT
    v.id,
    v.status,
    v.created_at,
    v.ended_at,
    v.ended_reason,
    v.ended_by_me,
    v.partner_anonymous_display_name,
    v.partner_anonymous_avatar,
    v.partner_verified,
    v.partner_age_display,
    v.partner_city,
    COALESCE(uc.unread_count, 0),
    CASE
      WHEN lm.id IS NULL THEN NULL
      WHEN lm.recalled_at IS NOT NULL THEN '此訊息已收回'
      WHEN lm.message_type = 'image' THEN '傳送了一張照片'
      ELSE left(regexp_replace(COALESCE(lm.content, ''), E'[\\n\\r\\t]+', ' ', 'g'), 80)
    END,
    lm.created_at,
    lm.message_type,
    lm.sender_id = actor.id
  FROM actor
  JOIN public.random_chat_sessions s
    ON actor.id IS NOT NULL
   AND s.status = 'active'
   AND (s.user_a = actor.id OR s.user_b = actor.id)
  CROSS JOIN LATERAL public.get_my_random_session_view(s.id) v
  LEFT JOIN LATERAL (
    SELECT m.id, m.content, m.message_type, m.created_at, m.sender_id, m.recalled_at
    FROM public.random_chat_messages m
    WHERE m.session_id = s.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS unread_count
    FROM public.random_chat_messages m
    LEFT JOIN public.random_chat_session_reads r
      ON r.session_id = s.id AND r.user_id = actor.id
    WHERE m.session_id = s.id
      AND m.sender_id <> actor.id
      AND m.recalled_at IS NULL
      AND m.created_at > COALESCE(r.last_read_at, s.created_at)
  ) uc ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    CASE WHEN COALESCE(uc.unread_count, 0) > 0 THEN 0 ELSE 1 END,
    COALESCE(lm.created_at, s.created_at) DESC,
    s.created_at DESC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_active_random_sessions() TO authenticated, service_role;
