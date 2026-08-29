CREATE TABLE IF NOT EXISTS public.moderation_enforcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id UUID NULL REFERENCES auth.users ON DELETE SET NULL,
  enforcement_type TEXT NOT NULL,
  reason_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  credential_hash TEXT NULL,
  ip_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT moderation_enforcements_type_valid CHECK (
    enforcement_type IN ('warning', 'temporary_suspension', 'permanent_ban')
  ),
  CONSTRAINT moderation_enforcements_status_valid CHECK (
    status IN ('active', 'expired', 'revoked')
  )
);

CREATE INDEX IF NOT EXISTS moderation_enforcements_subject_idx
ON public.moderation_enforcements (subject_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_enforcements_credential_idx
ON public.moderation_enforcements (credential_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_enforcements_ip_idx
ON public.moderation_enforcements (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_enforcements_active_idx
ON public.moderation_enforcements (status, enforcement_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signup_precheck_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_hash TEXT NULL,
  ip_hash TEXT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT signup_precheck_events_decision_valid CHECK (
    decision IN ('allow', 'needs_review', 'block', 'rate_limited')
  )
);

CREATE INDEX IF NOT EXISTS signup_precheck_events_ip_created_idx
ON public.signup_precheck_events (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS signup_precheck_events_credential_created_idx
ON public.signup_precheck_events (credential_hash, created_at DESC);

ALTER TABLE public.moderation_enforcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_precheck_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.moderation_enforcements FROM public, anon, authenticated;
REVOKE ALL ON public.signup_precheck_events FROM public, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderation_enforcements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_precheck_events TO service_role;
