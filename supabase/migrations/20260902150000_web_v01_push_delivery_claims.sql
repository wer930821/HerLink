-- Atomically claim push events so an immediate dispatcher and cron fallback
-- cannot deliver the same event concurrently.

ALTER TABLE public.push_notification_events
  ADD COLUMN IF NOT EXISTS event_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_token UUID;

UPDATE public.push_notification_events
SET event_created_at = created_at
WHERE event_created_at IS NULL;

ALTER TABLE public.push_notification_events
  ALTER COLUMN event_created_at SET DEFAULT timezone('utc'::text, now()),
  ALTER COLUMN event_created_at SET NOT NULL;

ALTER TABLE public.push_notification_events
  ADD COLUMN IF NOT EXISTS queue_delay_ms BIGINT GENERATED ALWAYS AS (
    CASE WHEN delivery_started_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM (delivery_started_at - event_created_at)) * 1000)::BIGINT END
  ) STORED,
  ADD COLUMN IF NOT EXISTS delivery_duration_ms BIGINT GENERATED ALWAYS AS (
    CASE WHEN delivered_at IS NULL OR delivery_started_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM (delivered_at - delivery_started_at)) * 1000)::BIGINT END
  ) STORED;

ALTER TABLE public.push_notification_events
  DROP CONSTRAINT IF EXISTS push_notification_events_status_check;

ALTER TABLE public.push_notification_events
  ADD CONSTRAINT push_notification_events_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS push_notification_events_claim_idx
  ON public.push_notification_events (status, event_created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_push_notification_events(
  p_event_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_include_failed BOOLEAN DEFAULT TRUE
)
RETURNS SETOF public.push_notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_at_value TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM public.push_notification_events AS event
    WHERE (p_event_id IS NULL OR event.id = p_event_id)
      AND (
        event.status = 'pending'
        OR (
          p_include_failed
          AND event.status = 'failed'
          AND event.delivery_attempts < 5
          AND event.processed_at <= claimed_at_value - INTERVAL '1 minute'
        )
        OR (
          event.status = 'processing'
          AND event.processing_claimed_at <= claimed_at_value - INTERVAL '5 minutes'
        )
      )
    ORDER BY event.event_created_at DESC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  )
  UPDATE public.push_notification_events AS event
  SET
    status = 'processing',
    processing_claimed_at = claimed_at_value,
    processing_claim_token = gen_random_uuid(),
    delivery_started_at = COALESCE(event.delivery_started_at, claimed_at_value)
  FROM candidates
  WHERE event.id = candidates.id
  RETURNING event.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_notification_events(UUID, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_push_notification_events(UUID, INTEGER, BOOLEAN) TO service_role;
