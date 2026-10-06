CREATE TABLE IF NOT EXISTS public.anonymous_recovery_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_identity_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  rotated_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  CONSTRAINT anonymous_recovery_credentials_version_positive CHECK (version > 0),
  CONSTRAINT anonymous_recovery_credentials_code_hash_nonempty CHECK (btrim(code_hash) <> ''),
  CONSTRAINT anonymous_recovery_credentials_code_hint_safe CHECK (code_hint ~ '^••••••[A-Z0-9]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_recovery_credentials_code_hash_unique
  ON public.anonymous_recovery_credentials (code_hash);

CREATE UNIQUE INDEX IF NOT EXISTS anonymous_recovery_credentials_one_active_per_identity
  ON public.anonymous_recovery_credentials (anonymous_identity_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS anonymous_recovery_credentials_identity_history_idx
  ON public.anonymous_recovery_credentials (anonymous_identity_id, created_at DESC);

ALTER TABLE public.anonymous_recovery_credentials ENABLE ROW LEVEL SECURITY;

-- Permanent recovery codes are password-equivalent credentials. Client roles get
-- no direct table access; server-side recovery functions use service_role.
REVOKE ALL ON public.anonymous_recovery_credentials FROM public, anon, authenticated;
GRANT ALL ON public.anonymous_recovery_credentials TO service_role;
