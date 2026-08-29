CREATE OR REPLACE FUNCTION public.list_my_blocked_users()
RETURNS TABLE (
  block_id UUID,
  blocked_user_id UUID,
  blocked_at TIMESTAMPTZ,
  anonymous_display_name TEXT,
  anonymous_avatar TEXT,
  verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    block.id AS block_id,
    block.blocked_user_id,
    block.created_at AS blocked_at,
    COALESCE(NULLIF(btrim(profile.anonymous_display_name), ''), '匿名使用者') AS anonymous_display_name,
    CASE
      WHEN NULLIF(btrim(COALESCE(profile.anonymous_avatar, '')), '') IS NOT NULL THEN profile.anonymous_avatar
      ELSE 'avatar_01'
    END AS anonymous_avatar,
    COALESCE(profile.verified, FALSE) AS verified
  FROM public.blocks AS block
  INNER JOIN public.profiles AS profile
    ON profile.id = block.blocked_user_id
  WHERE block.blocker_id = auth.uid()
  ORDER BY block.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_target_user_id UUID)
RETURNS TABLE (
  unblocked BOOLEAN,
  removed_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'You cannot unblock yourself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target user was not found.';
  END IF;

  DELETE FROM public.blocks
  WHERE blocker_id = actor_id
    AND blocked_user_id = p_target_user_id;

  GET DIAGNOSTICS removed_count = ROW_COUNT;

  RETURN QUERY SELECT removed_count > 0, removed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_blocked_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unblock_user(UUID) TO authenticated, service_role;