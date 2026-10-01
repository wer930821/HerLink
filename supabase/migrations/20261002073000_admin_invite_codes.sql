CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admin_invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  CONSTRAINT admin_invite_public_id_format CHECK (public_id ~ '^[A-F0-9]{8}$'),
  CONSTRAINT admin_invite_attempts_valid CHECK (failed_attempts >= 0 AND max_attempts BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS admin_invite_codes_active_expires_idx
ON public.admin_invite_codes (active, expires_at);

ALTER TABLE public.admin_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_invite_attempt_limits (
  attempt_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.admin_invite_attempt_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_admin_invite_code(
  p_expires_minutes INTEGER DEFAULT 30,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
  invite_code TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_public_id TEXT;
  v_secret TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  PERFORM public.require_active_admin(ARRAY['admin']);

  IF p_expires_minutes < 5 OR p_expires_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid invite expiry.';
  END IF;

  IF p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RAISE EXCEPTION 'Invalid max attempts.';
  END IF;

  LOOP
    v_public_id := UPPER(SUBSTRING(ENCODE(gen_random_bytes(8), 'hex') FROM 1 FOR 8));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.admin_invite_codes WHERE public_id = v_public_id
    );
  END LOOP;

  v_secret := ENCODE(gen_random_bytes(24), 'hex');
  v_expires := timezone('utc'::text, now()) + make_interval(mins => p_expires_minutes);

  INSERT INTO public.admin_invite_codes (
    public_id,
    secret_hash,
    created_by,
    expires_at,
    max_attempts
  )
  VALUES (
    v_public_id,
    ENCODE(digest(v_secret, 'sha256'), 'hex'),
    auth.uid(),
    v_expires,
    p_max_attempts
  );

  RETURN QUERY SELECT 'HL-' || v_public_id || '-' || v_secret, v_expires;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_admin_invite_rate_limit(
  p_attempt_key TEXT,
  p_max_attempts INTEGER DEFAULT 10,
  p_window_minutes INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_invite_attempt_limits%ROWTYPE;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF p_attempt_key IS NULL OR length(p_attempt_key) < 16 THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_row
  FROM public.admin_invite_attempt_limits
  WHERE attempt_key = p_attempt_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.admin_invite_attempt_limits (attempt_key, window_started_at, attempt_count, updated_at)
    VALUES (p_attempt_key, v_now, 1, v_now);
    RETURN TRUE;
  END IF;

  IF v_row.window_started_at <= v_now - make_interval(mins => p_window_minutes) THEN
    UPDATE public.admin_invite_attempt_limits
    SET window_started_at = v_now,
        attempt_count = 1,
        updated_at = v_now
    WHERE attempt_key = p_attempt_key;
    RETURN TRUE;
  END IF;

  IF v_row.attempt_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  UPDATE public.admin_invite_attempt_limits
  SET attempt_count = attempt_count + 1,
      updated_at = v_now
  WHERE attempt_key = p_attempt_key;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_invite_code(
  p_code TEXT,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_public_id TEXT;
  v_secret TEXT;
  v_row public.admin_invite_codes%ROWTYPE;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_next_attempts INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_code !~ '^HL-[A-Fa-f0-9]{8}-[A-Fa-f0-9]{48}$' THEN
    RETURN FALSE;
  END IF;

  v_public_id := UPPER(split_part(p_code, '-', 2));
  v_secret := LOWER(split_part(p_code, '-', 3));

  SELECT *
  INTO v_row
  FROM public.admin_invite_codes
  WHERE public_id = v_public_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF NOT v_row.active
     OR v_row.used_at IS NOT NULL
     OR v_row.expires_at <= v_now
     OR v_row.failed_attempts >= v_row.max_attempts THEN
    RETURN FALSE;
  END IF;

  IF ENCODE(digest(v_secret, 'sha256'), 'hex') <> v_row.secret_hash THEN
    v_next_attempts := v_row.failed_attempts + 1;
    UPDATE public.admin_invite_codes
    SET failed_attempts = v_next_attempts,
        active = CASE WHEN v_next_attempts >= max_attempts THEN FALSE ELSE active END
    WHERE id = v_row.id;
    RETURN FALSE;
  END IF;

  INSERT INTO public.admin_users (user_id, role, active)
  VALUES (p_user_id, 'admin', TRUE)
  ON CONFLICT (user_id)
  DO UPDATE SET role = 'admin', active = TRUE;

  UPDATE public.admin_invite_codes
  SET used_at = v_now,
      used_by = p_user_id,
      active = FALSE
  WHERE id = v_row.id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_invite_code(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_admin_invite_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_admin_invite_code(TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_admin_invite_code(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_admin_invite_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_admin_invite_code(TEXT, UUID) TO service_role;
