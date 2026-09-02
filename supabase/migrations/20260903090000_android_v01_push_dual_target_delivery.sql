-- Android V1: dual-target push delivery on the existing push_notification_events
-- queue. One event row independently records a Web Push result and an Expo
-- native result, with per-subscription / per-token audit tables. No second
-- event queue is introduced and no event status can overwrite the other target.

-- 1) Per-event delivery target ---------------------------------------------
ALTER TABLE public.push_notification_events
  ADD COLUMN IF NOT EXISTS delivery_target TEXT,
  ADD COLUMN IF NOT EXISTS web_delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS native_delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS web_last_error TEXT,
  ADD COLUMN IF NOT EXISTS native_last_error TEXT,
  ADD COLUMN IF NOT EXISTS web_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS native_delivered_at TIMESTAMPTZ;

-- Historical random events were delivered over Web Push only. They are marked
-- as "both" for future intent/audit but stay terminal (status sent/skipped is
-- never re-claimed), so old matches/messages are not pushed to Android.
UPDATE public.push_notification_events
SET delivery_target = CASE
  WHEN event_type IN ('random_match', 'random_message') THEN 'both'
  ELSE 'native'
END
WHERE delivery_target IS NULL;

ALTER TABLE public.push_notification_events
  ALTER COLUMN delivery_target SET DEFAULT 'native';

ALTER TABLE public.push_notification_events
  ALTER COLUMN delivery_target SET NOT NULL;

ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_delivery_target_valid;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_delivery_target_valid
  CHECK (delivery_target IN ('web', 'native', 'both'));

-- Current production routing: random chat events fan out to both targets;
-- every other event stays native-only. Keeping the constraint event-driven
-- makes a misconfigured target impossible without a deliberate migration.
ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_delivery_target_consistent;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_delivery_target_consistent
  CHECK (
    (
      delivery_target = 'both'
      AND event_type IN ('random_match', 'random_message')
    )
    OR
    (
      delivery_target IN ('web', 'native')
      AND event_type NOT IN ('random_match', 'random_message')
    )
  );

-- NULL means "not attempted yet / not applicable"; terminal target states are
-- explicit so cron retry can resume only the target that still needs delivery.
ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_web_status_valid;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_web_status_valid
  CHECK (web_delivery_status IS NULL OR web_delivery_status IN ('sent', 'failed', 'skipped'));

ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_native_status_valid;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_native_status_valid
  CHECK (native_delivery_status IS NULL OR native_delivery_status IN ('sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS push_notification_events_target_status_idx
  ON public.push_notification_events (delivery_target, native_delivery_status, web_delivery_status)
  WHERE status IN ('pending', 'processing', 'failed');

-- 2) enqueue_push_notification: derive delivery_target from event type ---------
DROP FUNCTION IF EXISTS public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.enqueue_push_notification(
  p_dedupe_key TEXT,
  p_event_type TEXT,
  p_user_id UUID,
  p_actor_user_id UUID,
  p_match_id UUID,
  p_message_id UUID,
  p_verification_id UUID,
  p_title TEXT,
  p_body TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_session_id UUID DEFAULT NULL,
  p_delivery_target TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id UUID;
  resolved_target TEXT;
  expected_target TEXT;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_dedupe_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification dedupe key is required.';
  END IF;

  IF p_event_type NOT IN ('new_match', 'new_message', 'verification_result', 'push_test', 'random_match', 'random_message') THEN
    RAISE EXCEPTION 'Unsupported push notification event type.';
  END IF;

  expected_target := CASE
    WHEN p_event_type IN ('random_match', 'random_message') THEN 'both'
    ELSE 'native'
  END;

  resolved_target := LOWER(BTRIM(COALESCE(p_delivery_target, expected_target)));
  IF resolved_target NOT IN ('web', 'native', 'both') THEN
    RAISE EXCEPTION 'Unsupported push delivery target.';
  END IF;

  IF resolved_target <> expected_target THEN
    RAISE EXCEPTION 'Push delivery target does not match event type.';
  END IF;

  INSERT INTO public.push_notification_events (
    dedupe_key,
    event_type,
    user_id,
    actor_user_id,
    match_id,
    message_id,
    verification_id,
    session_id,
    delivery_target,
    title,
    body,
    payload
  )
  VALUES (
    p_dedupe_key,
    p_event_type,
    p_user_id,
    p_actor_user_id,
    p_match_id,
    p_message_id,
    p_verification_id,
    p_session_id,
    resolved_target,
    p_title,
    p_body,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT id
    INTO event_id
    FROM public.push_notification_events
    WHERE dedupe_key = p_dedupe_key;
  END IF;

  RETURN event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_push_notification(TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO service_role;

-- 3) Native delivery audit (per token; mirrors web_push_deliveries) ----------
CREATE TABLE IF NOT EXISTS public.native_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.push_notification_events(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.push_tokens(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'revoked', 'skipped')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS native_push_deliveries_created_idx
  ON public.native_push_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS native_push_deliveries_event_idx
  ON public.native_push_deliveries (event_id);

CREATE INDEX IF NOT EXISTS native_push_deliveries_user_status_idx
  ON public.native_push_deliveries (user_id, status, created_at DESC);

ALTER TABLE public.native_push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.native_push_deliveries FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.native_push_deliveries TO service_role;
GRANT SELECT ON public.native_push_deliveries TO authenticated;

DROP POLICY IF EXISTS "Active admins can read all native push deliveries" ON public.native_push_deliveries;
CREATE POLICY "Active admins can read all native push deliveries"
  ON public.native_push_deliveries
  FOR SELECT
  USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));
