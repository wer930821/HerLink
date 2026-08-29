CREATE OR REPLACE FUNCTION public.assert_rate_limit(
  p_scope TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  usage_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF COALESCE(p_limit, 0) <= 0 OR COALESCE(p_window_seconds, 0) <= 0 THEN
    RAISE EXCEPTION 'Rate limit configuration is invalid.';
  END IF;

  INSERT INTO public.rate_limit_events (user_id, scope, metadata)
  VALUES (actor_id, p_scope, COALESCE(p_metadata, '{}'::jsonb));

  SELECT COUNT(*)
  INTO usage_count
  FROM public.rate_limit_events AS rate_event
  WHERE rate_event.user_id = actor_id
    AND rate_event.scope = p_scope
    AND rate_event.created_at >= timezone('utc'::text, now()) - make_interval(secs => p_window_seconds);

  IF usage_count > p_limit THEN
    RAISE EXCEPTION 'Too many attempts right now. Please try again later.';
  END IF;

  RETURN usage_count;
END;
$$;
