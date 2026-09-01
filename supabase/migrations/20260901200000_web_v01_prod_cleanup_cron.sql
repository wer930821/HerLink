-- Production hardening: schedule stale-data cleanup via pg_cron with run logging.

-- 1) Cleanup run log (service_role / DB only; no client policies)
CREATE TABLE IF NOT EXISTS public.cleanup_job_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name TEXT NOT NULL,
  affected_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cleanup_job_runs_started_idx
  ON public.cleanup_job_runs (started_at DESC);

ALTER TABLE public.cleanup_job_runs ENABLE ROW LEVEL SECURITY;

-- 2) Queue cleanup with run logging (only stale waiting rows; indexed; re-runnable)
CREATE OR REPLACE FUNCTION public.cleanup_stale_random_queue(p_max_age INTERVAL DEFAULT INTERVAL '24 hours')
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

  UPDATE public.random_match_queue
  SET status = 'left',
      updated_at = timezone('utc'::text, now()),
      matched_session_id = NULL
  WHERE status = 'waiting'
    AND updated_at < timezone('utc'::text, now()) - COALESCE(p_max_age, INTERVAL '24 hours');

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

-- 3) Media orphan cleanup with run logging (objects without message reference,
--    guarded by a grace period passed by the caller)
CREATE OR REPLACE FUNCTION public.cleanup_chat_media_orphans(p_max_age INTERVAL DEFAULT INTERVAL '1 hour')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INTEGER := 0;
  orphan_row RECORD;
  run_id BIGINT;
BEGIN
  INSERT INTO public.cleanup_job_runs (job_name, status)
  VALUES ('chat_media_orphans', 'running')
  RETURNING id INTO run_id;

  FOR orphan_row IN
    SELECT object_row.name
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-media'
      AND object_row.created_at < timezone('utc'::text, now()) - COALESCE(p_max_age, INTERVAL '1 hour')
      AND NOT EXISTS (
        SELECT 1
        FROM public.random_chat_messages AS message_row
        WHERE message_row.message_type = 'image'
          AND message_row.media_path = object_row.name
      )
  LOOP
    DELETE FROM storage.objects
    WHERE bucket_id = 'chat-media'
      AND name = orphan_row.name;
    removed := removed + 1;
  END LOOP;

  UPDATE public.cleanup_job_runs
  SET affected_rows = removed,
      finished_at = timezone('utc'::text, now()),
      status = 'success'
  WHERE id = run_id;

  RETURN removed;
EXCEPTION WHEN OTHERS THEN
  IF run_id IS NOT NULL THEN
    UPDATE public.cleanup_job_runs
    SET affected_rows = removed,
        finished_at = timezone('utc'::text, now()),
        status = 'failed',
        error = SQLERRM
    WHERE id = run_id;
  END IF;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_chat_media_orphans(INTERVAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_random_queue(INTERVAL) TO service_role;

-- 4) pg_cron jobs (idempotent: unschedule by name, then schedule)
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('herlink_cleanup_stale_random_queue', 'herlink_cleanup_chat_media_orphans');

SELECT cron.schedule(
  'herlink_cleanup_stale_random_queue',
  '0 * * * *',
  $$SELECT public.cleanup_stale_random_queue()$$
);

SELECT cron.schedule(
  'herlink_cleanup_chat_media_orphans',
  '17 */6 * * *',
  $$SELECT public.cleanup_chat_media_orphans(INTERVAL '6 hours')$$
);
