-- Drain historical random-chat push events without delivering stale notifications.
-- The queue audit trail is retained on each event (status, last_error, processed_at).

CREATE OR REPLACE FUNCTION public.expire_stale_random_web_push_backlog(
  p_message_max_age INTERVAL DEFAULT INTERVAL '5 minutes',
  p_match_max_age INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS TABLE (
  stale_session_count INTEGER,
  expired_backlog_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  processed_at_value TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- A notification is no longer meaningful if its random-chat session has ended
  -- (or no longer exists).  Mark it skipped before any age-based handling.
  UPDATE public.push_notification_events AS event
  SET
    status = 'skipped',
    last_error = 'stale_session',
    processed_at = processed_at_value
  WHERE event.status = 'pending'
    AND event.event_type IN ('random_match', 'random_message')
    AND NOT EXISTS (
      SELECT 1
      FROM public.random_chat_sessions AS conversation
      WHERE conversation.id = event.session_id
        AND conversation.status = 'active'
    );

  GET DIAGNOSTICS stale_session_count = ROW_COUNT;

  -- Do not resurrect old active-session alerts: message notifications age out
  -- faster than match notifications, while fresh events remain pending for cron.
  UPDATE public.push_notification_events AS event
  SET
    status = 'skipped',
    last_error = 'expired_backlog',
    processed_at = processed_at_value
  WHERE event.status = 'pending'
    AND (
      (event.event_type = 'random_message'
        AND event.created_at < processed_at_value - p_message_max_age)
      OR
      (event.event_type = 'random_match'
        AND event.created_at < processed_at_value - p_match_max_age)
    );

  GET DIAGNOSTICS expired_backlog_count = ROW_COUNT;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_random_web_push_backlog(INTERVAL, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_random_web_push_backlog(INTERVAL, INTERVAL) TO service_role;

-- One-time production drain. This only changes pending random-chat events to
-- skipped; it never calls the delivery function or sends a Web Push message.
SELECT * FROM public.expire_stale_random_web_push_backlog();
