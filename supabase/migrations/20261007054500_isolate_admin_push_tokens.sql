-- Keep native push tokens for the public HerLink app separate from the admin
-- app so chat/match notifications never reach the back-office shell.

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS token_context TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_token_context_valid;

ALTER TABLE public.push_tokens
  ADD CONSTRAINT push_tokens_token_context_valid
  CHECK (token_context IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS push_tokens_user_context_active_idx
  ON public.push_tokens (user_id, token_context, active, updated_at DESC);

UPDATE public.push_tokens
SET token_context = 'admin',
    updated_at = timezone('utc'::text, now())
WHERE device_hash = 'herlink-admin-app'
  AND token_context <> 'admin';

DROP FUNCTION IF EXISTS public.create_or_update_push_token(TEXT, TEXT, TEXT);

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
  actor_id UUID := auth.uid();
  token_value TEXT := NULLIF(BTRIM(COALESCE(p_expo_push_token, '')), '');
  platform_value TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_platform), ''), 'unknown'));
  context_value TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_token_context), ''), 'user'));
  row_value public.push_tokens%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
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
    actor_id,
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
