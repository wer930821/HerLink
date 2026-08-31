CREATE INDEX IF NOT EXISTS blocks_created_at_idx
  ON public.blocks (created_at DESC);

CREATE INDEX IF NOT EXISTS reports_created_at_idx
  ON public.reports (created_at DESC);

CREATE INDEX IF NOT EXISTS random_chat_sessions_created_at_idx
  ON public.random_chat_sessions (created_at DESC);

CREATE INDEX IF NOT EXISTS random_chat_sessions_ended_at_idx
  ON public.random_chat_sessions (ended_at DESC);

CREATE INDEX IF NOT EXISTS random_chat_messages_created_at_idx
  ON public.random_chat_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS fraud_risk_events_created_at_idx
  ON public.fraud_risk_events (created_at DESC);

CREATE INDEX IF NOT EXISTS moderation_enforcements_created_at_idx
  ON public.moderation_enforcements (created_at DESC);

CREATE TABLE IF NOT EXISTS public.realtime_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message_id UUID NULL REFERENCES public.random_chat_messages(id) ON DELETE SET NULL,
  client_instance_id TEXT NOT NULL,
  safe_error_code TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT realtime_diagnostics_event_type_valid CHECK (
    event_type IN (
      'realtime_subscribe_started',
      'realtime_subscribed',
      'realtime_subscribe_error',
      'realtime_disconnected',
      'realtime_reconnected',
      'message_received_realtime',
      'message_loaded_from_db'
    )
  ),
  CONSTRAINT realtime_diagnostics_client_instance_not_blank CHECK (length(btrim(client_instance_id)) > 0)
);

CREATE INDEX IF NOT EXISTS realtime_diagnostics_session_created_idx
  ON public.realtime_diagnostics (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS realtime_diagnostics_event_created_idx
  ON public.realtime_diagnostics (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS realtime_diagnostics_user_created_idx
  ON public.realtime_diagnostics (user_id, created_at DESC);

ALTER TABLE public.realtime_diagnostics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.realtime_diagnostics FROM public, anon;
GRANT SELECT ON public.realtime_diagnostics TO authenticated, service_role;

DROP POLICY IF EXISTS "Active admins can read realtime diagnostics" ON public.realtime_diagnostics;
CREATE POLICY "Active admins can read realtime diagnostics"
ON public.realtime_diagnostics
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all blocks" ON public.blocks;
CREATE POLICY "Active admins can read all blocks"
ON public.blocks
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all random chat sessions" ON public.random_chat_sessions;
CREATE POLICY "Active admins can read all random chat sessions"
ON public.random_chat_sessions
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all random match queue rows" ON public.random_match_queue;
CREATE POLICY "Active admins can read all random match queue rows"
ON public.random_match_queue
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all random chat messages" ON public.random_chat_messages;
CREATE POLICY "Active admins can read all random chat messages"
ON public.random_chat_messages
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all fraud risk events" ON public.fraud_risk_events;
CREATE POLICY "Active admins can read all fraud risk events"
ON public.fraud_risk_events
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

DROP POLICY IF EXISTS "Active admins can read all moderation enforcements" ON public.moderation_enforcements;
CREATE POLICY "Active admins can read all moderation enforcements"
ON public.moderation_enforcements
FOR SELECT
USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

GRANT SELECT ON public.fraud_risk_events TO authenticated, service_role;
GRANT SELECT ON public.moderation_enforcements TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_realtime_diagnostic(
  p_session_id UUID,
  p_event_type TEXT,
  p_client_instance_id TEXT,
  p_message_id UUID DEFAULT NULL,
  p_safe_error_code TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  inserted_id UUID;
  normalized_event_type TEXT := lower(btrim(COALESCE(p_event_type, '')));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session id is required.';
  END IF;

  IF btrim(COALESCE(p_client_instance_id, '')) = '' THEN
    RAISE EXCEPTION 'Client instance id is required.';
  END IF;

  IF normalized_event_type NOT IN (
    'realtime_subscribe_started',
    'realtime_subscribed',
    'realtime_subscribe_error',
    'realtime_disconnected',
    'realtime_reconnected',
    'message_received_realtime',
    'message_loaded_from_db'
  ) THEN
    RAISE EXCEPTION 'Unsupported realtime diagnostic event.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.random_chat_sessions AS session_row
    WHERE session_row.id = p_session_id
      AND (session_row.user_a = actor_id OR session_row.user_b = actor_id)
  ) THEN
    RAISE EXCEPTION 'Session is not available.';
  END IF;

  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.random_chat_messages AS message_row
    WHERE message_row.id = p_message_id
      AND message_row.session_id = p_session_id
  ) THEN
    RAISE EXCEPTION 'Message is not available.';
  END IF;

  INSERT INTO public.realtime_diagnostics (
    session_id,
    user_id,
    event_type,
    message_id,
    client_instance_id,
    safe_error_code,
    metadata,
    created_at
  )
  VALUES (
    p_session_id,
    actor_id,
    normalized_event_type,
    p_message_id,
    btrim(p_client_instance_id),
    NULLIF(btrim(COALESCE(p_safe_error_code, '')), ''),
    COALESCE(p_metadata, '{}'::jsonb),
    timezone('utc'::text, now())
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_realtime_diagnostic(UUID, TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;
