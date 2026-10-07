-- Keep older web/native clients working after push token contexts were added.
-- The legacy 3-argument RPC registers normal HerLink user tokens only.

CREATE OR REPLACE FUNCTION public.create_or_update_push_token(
  p_expo_push_token TEXT,
  p_device_hash TEXT DEFAULT NULL,
  p_platform TEXT DEFAULT 'unknown'
)
RETURNS public.push_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.create_or_update_push_token(
    p_expo_push_token,
    p_device_hash,
    p_platform,
    'user'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_update_push_token(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_push_token(TEXT, TEXT, TEXT) TO authenticated, service_role;
