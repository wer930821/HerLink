-- Keep browser-installation recovery compatible with the stable anonymous identity model.
-- IMPORTANT: recovery must never rewrite random_chat_sessions participants or historical
-- random_chat_messages.sender_id. The current auth principal is only a device principal;
-- resolve_active_anonymous_chat_identity() is the stable chat identity.

CREATE OR REPLACE FUNCTION public.restore_random_session_from_installation(
  p_session_id UUID,
  p_installation_id TEXT
)
RETURNS public.random_chat_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_user_id UUID := auth.uid();
  actor_id UUID := public.resolve_active_anonymous_chat_identity();
  installation_key_value TEXT := public.anonymous_installation_key(p_installation_id);
  identity_row public.anonymous_risk_identities%ROWTYPE;
  session_row public.random_chat_sessions%ROWTYPE;
BEGIN
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Anonymous identity is not available.';
  END IF;
  IF installation_key_value IS NULL THEN
    RAISE EXCEPTION 'Anonymous installation id is required.';
  END IF;

  -- The supplied installation must belong to the current auth/device principal.
  SELECT * INTO identity_row
  FROM public.anonymous_risk_identities r
  WHERE r.installation_key = installation_key_value
    AND r.current_user_id = auth_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery identity could not be verified.';
  END IF;

  SELECT * INTO session_row
  FROM public.random_chat_sessions s
  WHERE s.id = p_session_id
    AND s.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  -- New recovery model: the device principal resolves to the original stable anonymous
  -- identity. Do not migrate participants or message authorship to auth.uid().
  IF session_row.user_a <> actor_id AND session_row.user_b <> actor_id THEN
    RAISE EXCEPTION 'Recovery identity does not belong to this session.';
  END IF;

  RETURN session_row;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_random_session_from_installation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_random_session_from_installation(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.restore_random_session_from_installation(UUID, TEXT) IS
  'Verifies same-installation access using the stable anonymous identity. Never rewrites session participants or historical message sender IDs.';
