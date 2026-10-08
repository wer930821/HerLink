-- Restore the profile completion flag required by the Web/App profile contract.
-- This is additive and does not replace profile ids or touch chat/session history.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Existing anonymous identities that are already configured should remain usable.
UPDATE public.profiles
SET onboarding_completed = TRUE
WHERE onboarding_completed IS NOT TRUE
  AND anonymous_mode_enabled IS TRUE
  AND NULLIF(BTRIM(anonymous_display_name), '') IS NOT NULL;
