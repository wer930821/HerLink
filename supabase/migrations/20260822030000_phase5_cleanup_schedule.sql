CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.configure_verification_media_cleanup_schedule(
  p_project_url TEXT,
  p_secret_key TEXT,
  p_schedule TEXT DEFAULT '15 3 * * *'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can configure verification cleanup schedule.';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_project_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Project URL is required.';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_secret_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Secret key is required.';
  END IF;

  PERFORM vault.create_secret(p_project_url, 'herlink_project_url');
  PERFORM vault.create_secret(p_secret_key, 'herlink_cleanup_secret_key');

  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'herlink_verification_media_cleanup_daily'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'herlink_verification_media_cleanup_daily',
    p_schedule,
    $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'herlink_project_url'
        ORDER BY created_at DESC
        LIMIT 1
      ) || '/functions/v1/verification-media-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'herlink_cleanup_secret_key'
          ORDER BY created_at DESC
          LIMIT 1
        )
      ),
      body := '{}'::jsonb
    );
    $cron$
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.configure_verification_media_cleanup_schedule(TEXT, TEXT, TEXT) TO service_role;
