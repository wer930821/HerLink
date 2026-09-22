CREATE OR REPLACE FUNCTION public.list_admin_realtime_diagnostics(
  p_session_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  user_id UUID,
  event_type TEXT,
  message_id UUID,
  client_instance_id TEXT,
  safe_error_code TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  safe_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  safe_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = actor_id
      AND role = 'admin'
      AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.session_id,
    d.user_id,
    d.event_type,
    d.message_id,
    d.client_instance_id,
    d.safe_error_code,
    d.metadata,
    d.created_at,
    COUNT(*) OVER() AS total_count
  FROM public.realtime_diagnostics AS d
  WHERE (p_session_id IS NULL OR d.session_id = p_session_id)
    AND (p_event_type IS NULL OR d.event_type = p_event_type)
  ORDER BY d.created_at DESC
  OFFSET safe_offset
  LIMIT safe_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_realtime_diagnostics(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_admin_realtime_diagnostics(UUID, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_admin_realtime_diagnostics(UUID, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_realtime_diagnostics(UUID, TEXT, INTEGER, INTEGER) TO service_role;
