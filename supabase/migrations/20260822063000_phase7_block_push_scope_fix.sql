CREATE OR REPLACE FUNCTION public.block_user(target_user_id UUID)
RETURNS TABLE (
  blocked BOOLEAN,
  active_match_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  created_block_id UUID;
  block_count INTEGER := 0;
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM public.assert_rate_limit(
    'block_user',
    20,
    3600,
    jsonb_build_object('target_user_id', target_user_id)
  );

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot block yourself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user was not found.';
  END IF;

  INSERT INTO public.blocks (blocker_id, blocked_user_id)
  VALUES (actor_id, target_user_id)
  ON CONFLICT (blocker_id, blocked_user_id) DO NOTHING
  RETURNING id INTO created_block_id;

  DELETE FROM public.likes
  WHERE (from_user_id = actor_id AND to_user_id = target_user_id)
     OR (from_user_id = target_user_id AND to_user_id = actor_id);

  UPDATE public.matches
  SET status = 'blocked'
  WHERE status = 'active'
    AND (user_1_id = LEAST(actor_id, target_user_id) AND user_2_id = GREATEST(actor_id, target_user_id));

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  SELECT COUNT(*)
  INTO block_count
  FROM public.blocks
  WHERE blocked_user_id = target_user_id;

  IF block_count = 2 THEN
    PERFORM public.apply_risk_event(
      target_user_id,
      'multiple_blocks_received',
      jsonb_build_object('block_count', block_count, 'triggered_by', actor_id)
    );
  END IF;

  RETURN QUERY SELECT TRUE, updated_rows > 0;
END;
$$;
