CREATE OR REPLACE FUNCTION public.get_admin_random_chat_stats()
RETURNS TABLE (
  today_users BIGINT,
  today_messages BIGINT,
  today_sessions BIGINT,
  today_queue_joins BIGINT,
  seven_day_users BIGINT,
  seven_day_messages BIGINT,
  seven_day_sessions BIGINT,
  seven_day_queue_joins BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  today_start TIMESTAMPTZ :=
    ((timezone('Asia/Taipei', now()))::date::timestamp AT TIME ZONE 'Asia/Taipei');
  seven_day_start TIMESTAMPTZ := now() - INTERVAL '7 days';
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = actor_id
      AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(DISTINCT sender_id)
       FROM public.random_chat_messages
      WHERE created_at >= today_start),
    (SELECT COUNT(*)
       FROM public.random_chat_messages
      WHERE created_at >= today_start),
    (SELECT COUNT(*)
       FROM public.random_chat_sessions
      WHERE created_at >= today_start),
    (SELECT COUNT(*)
       FROM public.random_match_queue
      WHERE joined_at >= today_start),
    (SELECT COUNT(DISTINCT sender_id)
       FROM public.random_chat_messages
      WHERE created_at >= seven_day_start),
    (SELECT COUNT(*)
       FROM public.random_chat_messages
      WHERE created_at >= seven_day_start),
    (SELECT COUNT(*)
       FROM public.random_chat_sessions
      WHERE created_at >= seven_day_start),
    (SELECT COUNT(*)
       FROM public.random_match_queue
      WHERE joined_at >= seven_day_start);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_random_chat_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_random_chat_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_random_chat_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_random_chat_stats() TO service_role;
