-- Do not revive historical failed events while enabling retry for fresh traffic.
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
          AND event.event_created_at >= claimed_at_value - INTERVAL '15 minutes'
          AND event.processed_at <= claimed_at_value - INTERVAL '1 minute'
        )
        OR (
          event.status = 'processing'
          AND event.event_created_at >= claimed_at_value - INTERVAL '15 minutes'
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
