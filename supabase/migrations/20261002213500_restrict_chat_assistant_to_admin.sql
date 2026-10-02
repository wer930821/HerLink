CREATE OR REPLACE FUNCTION public.can_use_chat_assistant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_admin(ARRAY['admin']::text[]);
$$;

REVOKE ALL ON FUNCTION public.can_use_chat_assistant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_use_chat_assistant() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_chat_assistant_context(p_session_id uuid)
RETURNS TABLE (allowed boolean, session_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_active_admin(ARRAY['admin']::text[]) AS allowed,
    CASE WHEN public.is_active_admin(ARRAY['admin']::text[]) THEN p_session_id ELSE NULL::uuid END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_assistant_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_assistant_context(uuid) TO authenticated;
