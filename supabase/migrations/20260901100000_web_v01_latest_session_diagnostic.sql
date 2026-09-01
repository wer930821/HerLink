CREATE OR REPLACE FUNCTION public.get_my_latest_random_session_diagnostic()
RETURNS TABLE (
  session_id UUID,
  status TEXT,
  ended_reason TEXT,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  ended_by_me BOOLEAN,
  ended_by_partner BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    session_row.id AS session_id,
    session_row.status,
    session_row.ended_reason,
    session_row.ended_at,
    session_row.created_at,
    CASE
      WHEN session_row.ended_by IS NULL THEN NULL::BOOLEAN
      ELSE session_row.ended_by = auth.uid()
    END AS ended_by_me,
    CASE
      WHEN session_row.ended_by IS NULL THEN NULL::BOOLEAN
      ELSE session_row.ended_by <> auth.uid()
    END AS ended_by_partner
  FROM public.random_chat_sessions AS session_row
  WHERE auth.uid() IS NOT NULL
    AND (session_row.user_a = auth.uid() OR session_row.user_b = auth.uid())
  ORDER BY session_row.created_at DESC, session_row.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_latest_random_session_diagnostic() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_latest_random_session_diagnostic() TO authenticated;
