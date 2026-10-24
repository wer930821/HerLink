-- 推播 token 必須綁在「有效聊天身分」上，而不是登入用的 auth id。
--
-- 問題：接回來的身分（例如煮月耳機）其聊天身分 id 跟登入用的
-- auth id 是分開的（靠 anonymous_identity_device_state 綁定），但
-- 舊版 create_or_update_push_token 一律用 auth.uid() 當 user_id，
-- 後端寄推播時卻用聊天身分 id 去找 token，兩邊對不起來，結果就是
-- no_active_tokens，App 永遠收不到推播。
--
-- 修法：token_context='user' 時，user_id 改用
-- resolve_active_anonymous_chat_identity()（接回身分時回傳身分 id，
-- 一般身分時回傳 auth id 本身，行為不變）；admin token 不受影響，
-- 仍用 auth.uid()，避免管理員推播被誤綁到匿名身分。
--
-- 注意：這支 migration 只改註冊邏輯，不會自動搬移舊 token。
-- 執行後，App 下次登入（或接回身分後）重新註冊 token 時，同一支
-- 手機的 Expo token 會因 ON CONFLICT 被更新到正確的身分 id 上，
-- 之後推播才會通。正式庫請使用者在 Supabase SQL Editor 手動執行。

CREATE OR REPLACE FUNCTION public.create_or_update_push_token(
  p_expo_push_token TEXT,
  p_device_hash TEXT DEFAULT NULL,
  p_platform TEXT DEFAULT 'unknown',
  p_token_context TEXT DEFAULT 'user'
)
RETURNS public.push_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_id UUID := auth.uid();
  token_value TEXT := NULLIF(BTRIM(COALESCE(p_expo_push_token, '')), '');
  platform_value TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_platform), ''), 'unknown'));
  context_value TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_token_context), ''), 'user'));
  owner_id UUID;
  row_value public.push_tokens%ROWTYPE;
BEGIN
  IF auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF token_value IS NULL OR LENGTH(token_value) < 16 THEN
    RAISE EXCEPTION 'Push token is invalid.';
  END IF;

  IF platform_value NOT IN ('android', 'ios', 'web', 'unknown') THEN
    platform_value := 'unknown';
  END IF;

  IF context_value NOT IN ('user', 'admin') THEN
    context_value := 'user';
  END IF;

  IF context_value = 'admin' AND NOT public.is_active_admin(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only active admins can register admin push tokens.';
  END IF;

  -- user token 綁有效身分，admin token 綁登入帳號本身。
  IF context_value = 'user' THEN
    owner_id := COALESCE(public.resolve_active_anonymous_chat_identity(), auth_id);
  ELSE
    owner_id := auth_id;
  END IF;

  INSERT INTO public.push_tokens (
    user_id,
    expo_push_token,
    device_hash,
    platform,
    token_context,
    active,
    updated_at
  )
  VALUES (
    owner_id,
    token_value,
    NULLIF(BTRIM(COALESCE(p_device_hash, '')), ''),
    platform_value,
    context_value,
    TRUE,
    timezone('utc'::text, now())
  )
  ON CONFLICT (expo_push_token)
  DO UPDATE
  SET user_id = EXCLUDED.user_id,
      device_hash = EXCLUDED.device_hash,
      platform = EXCLUDED.platform,
      token_context = EXCLUDED.token_context,
      active = TRUE,
      updated_at = timezone('utc'::text, now())
  RETURNING * INTO row_value;

  RETURN row_value;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_update_push_token(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_push_token(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
