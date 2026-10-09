-- Contract test for push egress optimization.
-- Random chat notifications must not enqueue work for recipients with no active push endpoint.
DO $$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'enqueue_push_notification'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF fn IS NULL THEN
    RAISE EXCEPTION 'enqueue_push_notification is missing';
  END IF;

  IF fn NOT ILIKE '%web_push_subscriptions%'
     OR fn NOT ILIKE '%push_tokens%'
     OR fn NOT ILIKE '%is_active%'
     OR fn NOT ILIKE '%RETURN NULL%' THEN
    RAISE EXCEPTION 'random push endpoint gate is missing';
  END IF;
END $$;
