CREATE TABLE IF NOT EXISTS public.admin_bootstrap_settings (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  owner_email_hash TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.admin_bootstrap_settings (
  singleton_id,
  owner_email_hash
)
VALUES (
  1,
  '3fa77eed3c5105c649be47fa020eb1998919e293aad264243b3e6650ae5f9f2f'
)
ON CONFLICT (singleton_id)
DO UPDATE SET
  owner_email_hash = EXCLUDED.owner_email_hash,
  updated_at = timezone('utc'::text, now());

ALTER TABLE public.admin_bootstrap_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_bootstrap_available()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_bootstrap_settings
    WHERE singleton_id = 1
      AND claimed_at IS NULL
      AND claimed_by IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_admin_bootstrap()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_row public.admin_bootstrap_settings%ROWTYPE;
  v_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_email_hash TEXT;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT email, email_confirmed_at
  INTO v_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RETURN FALSE;
  END IF;

  v_email_hash := ENCODE(digest(lower(trim(v_email)), 'sha256'), 'hex');

  SELECT *
  INTO v_row
  FROM public.admin_bootstrap_settings
  WHERE singleton_id = 1
  FOR UPDATE;

  IF NOT FOUND
     OR v_row.claimed_at IS NOT NULL
     OR v_row.claimed_by IS NOT NULL
     OR lower(v_row.owner_email_hash) <> lower(v_email_hash) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.admin_users (user_id, role, active)
  VALUES (auth.uid(), 'admin', TRUE)
  ON CONFLICT (user_id)
  DO UPDATE SET role = 'admin', active = TRUE;

  UPDATE public.admin_bootstrap_settings
  SET claimed_at = v_now,
      claimed_by = auth.uid(),
      updated_at = v_now
  WHERE singleton_id = 1;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bootstrap_available() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_admin_bootstrap() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_bootstrap_available() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_bootstrap() TO authenticated;
