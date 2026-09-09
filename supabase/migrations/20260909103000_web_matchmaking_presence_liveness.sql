-- Queue membership is durable, while match eligibility must reflect a live client.
-- Use the server-owned activity heartbeat for both candidate selection and cleanup.

CREATE INDEX IF NOT EXISTS online_activity_user_seen_idx
  ON public.online_activity (user_id, seen_at DESC);

CREATE OR REPLACE FUNCTION public.join_random_match_internal(
  p_actor_id UUID,
  p_excluded_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  status TEXT,
  session_id UUID,
  matched_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_profile RECORD;
  actor_session RECORD;
  candidate_user_id UUID;
  session_uuid UUID;
  was_waiting BOOLEAN := FALSE;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);
  PERFORM public.reconcile_anonymous_matchmaking_identity(p_actor_id);

  SELECT profile.account_status
  INTO actor_profile
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF actor_profile.account_status <> 'active' THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;
  IF NOT public.is_anonymous_matchmaking_allowed(p_actor_id) THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;

  SELECT session_row.* INTO actor_session
  FROM public.random_chat_sessions AS session_row
  WHERE session_row.status = 'active' AND (session_row.user_a = p_actor_id OR session_row.user_b = p_actor_id)
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'matched'::TEXT, actor_session.id, NULL::UUID;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.random_match_queue AS queue_row
    WHERE queue_row.user_id = p_actor_id AND queue_row.status = 'waiting'
  ) INTO was_waiting;

  INSERT INTO public.random_match_queue (user_id, status, joined_at, updated_at, matched_session_id)
  VALUES (p_actor_id, 'waiting', timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    joined_at = CASE WHEN random_match_queue.status = 'waiting' THEN random_match_queue.joined_at ELSE EXCLUDED.joined_at END,
    updated_at = EXCLUDED.updated_at,
    matched_session_id = NULL;

  IF NOT was_waiting THEN
    PERFORM public.record_anonymous_risk_event_by_user_id(
      p_actor_id, 'queue_join', jsonb_build_object('excluded_user_id', p_excluded_user_id)
    );
  END IF;

  SELECT queue_row.user_id INTO candidate_user_id
  FROM public.random_match_queue AS queue_row
  JOIN public.profiles AS candidate_profile ON candidate_profile.id = queue_row.user_id
  WHERE queue_row.status = 'waiting'
    AND queue_row.user_id <> p_actor_id
    AND (p_excluded_user_id IS NULL OR queue_row.user_id <> p_excluded_user_id)
    AND candidate_profile.account_status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.online_activity AS activity
      WHERE activity.user_id = queue_row.user_id
        AND activity.seen_at >= now() - INTERVAL '90 seconds'
    )
    AND public.is_anonymous_matchmaking_allowed(queue_row.user_id)
    AND NOT public.has_block_between(p_actor_id, queue_row.user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.random_chat_sessions AS existing_session
      WHERE existing_session.status = 'active'
        AND (existing_session.user_a = queue_row.user_id OR existing_session.user_b = queue_row.user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.random_pair_history AS history
      WHERE history.pair_key = public.random_pair_key(p_actor_id, queue_row.user_id)
        AND history.matched_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
    )
  ORDER BY queue_row.joined_at ASC, queue_row.user_id ASC
  LIMIT 1 FOR UPDATE OF queue_row SKIP LOCKED;

  IF FOUND THEN
    session_uuid := gen_random_uuid();
    INSERT INTO public.random_chat_sessions (id, user_a, user_b, status, created_at)
    VALUES (session_uuid, LEAST(p_actor_id, candidate_user_id), GREATEST(p_actor_id, candidate_user_id), 'active', timezone('utc'::text, now()));
    INSERT INTO public.random_pair_history (pair_key, user_a, user_b, matched_at)
    VALUES (public.random_pair_key(p_actor_id, candidate_user_id), LEAST(p_actor_id, candidate_user_id), GREATEST(p_actor_id, candidate_user_id), timezone('utc'::text, now()));
    UPDATE public.random_match_queue SET status = 'matched', updated_at = timezone('utc'::text, now()), matched_session_id = session_uuid
    WHERE user_id IN (p_actor_id, candidate_user_id);
    RETURN QUERY SELECT 'matched'::TEXT, session_uuid, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'waiting'::TEXT, NULL::UUID, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_random_queue(p_max_age INTERVAL DEFAULT INTERVAL '90 seconds')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned INTEGER := 0;
  run_id BIGINT;
BEGIN
  INSERT INTO public.cleanup_job_runs (job_name, status)
  VALUES ('stale_random_queue', 'running')
  RETURNING id INTO run_id;

  UPDATE public.random_match_queue AS queue_row
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE queue_row.status = 'waiting'
    AND NOT EXISTS (
      SELECT 1 FROM public.online_activity AS activity
      WHERE activity.user_id = queue_row.user_id
        AND activity.seen_at >= now() - COALESCE(p_max_age, INTERVAL '90 seconds')
    );

  GET DIAGNOSTICS cleaned = ROW_COUNT;

  UPDATE public.cleanup_job_runs
  SET affected_rows = cleaned,
      finished_at = timezone('utc'::text, now()),
      status = 'success'
  WHERE id = run_id;

  RETURN cleaned;
EXCEPTION WHEN OTHERS THEN
  IF run_id IS NOT NULL THEN
    UPDATE public.cleanup_job_runs
    SET affected_rows = cleaned,
        finished_at = timezone('utc'::text, now()),
        status = 'failed',
        error = SQLERRM
    WHERE id = run_id;
  END IF;
  RAISE;
END;
$$;

DO $migration$
BEGIN
  -- pg_cron is available in the hosted project. Keeping this conditional also
  -- lets the SQL regression suite run on its isolated PostgreSQL harness.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE $schedule$
      SELECT cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'herlink_cleanup_stale_random_queue'
    $schedule$;
    EXECUTE $schedule$
      SELECT cron.schedule(
        'herlink_cleanup_stale_random_queue',
        '* * * * *',
        $$SELECT public.cleanup_stale_random_queue()$$
      )
    $schedule$;
  END IF;
END;
$migration$;
