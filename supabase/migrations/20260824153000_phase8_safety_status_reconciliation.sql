CREATE OR REPLACE FUNCTION public.reconcile_profile_enforcement_status(
  p_target_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  account_status TEXT,
  changed BOOLEAN,
  active_temporary_suspensions INTEGER,
  active_permanent_bans INTEGER,
  expired_temporary_suspensions INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  current_status TEXT;
  next_status TEXT;
  latest_manual_status_action TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF actor_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_target_user_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'You may only reconcile your own enforcement status.';
    END IF;
  END IF;

  UPDATE public.moderation_enforcements
  SET status = 'expired'
  WHERE subject_user_id = p_target_user_id
    AND status = 'active'
    AND enforcement_type = 'temporary_suspension'
    AND expires_at IS NOT NULL
    AND expires_at <= timezone('utc'::text, now());

  SELECT profile.account_status
  INTO current_status
  FROM public.profiles AS profile
  WHERE profile.id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found.';
  END IF;

  SELECT COUNT(*)
  INTO active_temporary_suspensions
  FROM public.moderation_enforcements AS enforcement
  WHERE enforcement.subject_user_id = p_target_user_id
    AND enforcement.status = 'active'
    AND enforcement.enforcement_type = 'temporary_suspension'
    AND (enforcement.expires_at IS NULL OR enforcement.expires_at > timezone('utc'::text, now()));

  SELECT COUNT(*)
  INTO active_permanent_bans
  FROM public.moderation_enforcements AS enforcement
  WHERE enforcement.subject_user_id = p_target_user_id
    AND enforcement.status = 'active'
    AND enforcement.enforcement_type = 'permanent_ban';

  SELECT COUNT(*)
  INTO expired_temporary_suspensions
  FROM public.moderation_enforcements AS enforcement
  WHERE enforcement.subject_user_id = p_target_user_id
    AND enforcement.status = 'expired'
    AND enforcement.enforcement_type = 'temporary_suspension';

  SELECT moderation_log.action
  INTO latest_manual_status_action
  FROM public.moderation_logs AS moderation_log
  WHERE moderation_log.target_user_id = p_target_user_id
    AND moderation_log.action IN ('account_suspended', 'account_restored')
  ORDER BY moderation_log.created_at DESC
  LIMIT 1;

  next_status := current_status;

  IF current_status <> 'deletion_pending' THEN
    IF active_permanent_bans > 0 OR active_temporary_suspensions > 0 THEN
      next_status := 'suspended';
    ELSIF current_status = 'suspended'
      AND expired_temporary_suspensions > 0
      AND COALESCE(latest_manual_status_action, 'account_restored') <> 'account_suspended' THEN
      next_status := 'active';
    END IF;
  END IF;

  IF next_status IS DISTINCT FROM current_status THEN
    PERFORM set_config('herlink.internal_profile_update', 'on', true);

    UPDATE public.profiles AS profile
    SET account_status = next_status
    WHERE profile.id = p_target_user_id;

    IF next_status = 'active' THEN
      PERFORM public.internal_write_moderation_log(
        NULL,
        CASE WHEN auth.role() = 'service_role' THEN NULL ELSE actor_id END,
        p_target_user_id,
        'account_restored',
        'Temporary suspension expired.',
        jsonb_build_object(
          'reconciled_by', CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE 'self_check' END,
          'expired_temporary_suspensions', expired_temporary_suspensions
        )
      );
    END IF;
  END IF;

  account_status := next_status;
  changed := next_status IS DISTINCT FROM current_status;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_profile_enforcement_status(UUID) TO authenticated, service_role;
