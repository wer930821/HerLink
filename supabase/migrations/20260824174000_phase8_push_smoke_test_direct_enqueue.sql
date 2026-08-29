CREATE OR REPLACE FUNCTION public.enqueue_self_push_test_notification()
RETURNS TABLE (
  event_id UUID,
  active_token_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  active_profile public.profiles%ROWTYPE;
  next_event_id UUID := gen_random_uuid();
  token_count INTEGER := 0;
  dedupe_value TEXT;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO active_profile
  FROM public.profiles
  WHERE id = actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF active_profile.account_status <> 'active' OR active_profile.onboarding_completed <> TRUE THEN
    RAISE EXCEPTION 'Your account is not eligible for push testing right now.';
  END IF;

  PERFORM public.assert_rate_limit(
    'push_self_test_notification',
    3,
    60,
    jsonb_build_object('kind', 'push_test')
  );

  SELECT COUNT(*)
  INTO token_count
  FROM public.push_tokens
  WHERE user_id = actor_id
    AND active = TRUE;

  IF token_count <= 0 THEN
    RAISE EXCEPTION 'No active push token is registered for this account.';
  END IF;

  dedupe_value := 'push_test:' || actor_id::text || ':' || replace(clock_timestamp()::text, ' ', 'T');

  INSERT INTO public.push_notification_events (
    id,
    dedupe_key,
    event_type,
    user_id,
    actor_user_id,
    match_id,
    message_id,
    verification_id,
    title,
    body,
    payload
  )
  VALUES (
    next_event_id,
    dedupe_value,
    'push_test',
    actor_id,
    actor_id,
    NULL,
    NULL,
    NULL,
    'HerLink',
    '這是一則測試通知',
    jsonb_build_object(
      'kind', 'push_test',
      'type', 'push_test'
    )
  );

  event_id := next_event_id;
  active_token_count := token_count;
  RETURN NEXT;
END;
$$;
