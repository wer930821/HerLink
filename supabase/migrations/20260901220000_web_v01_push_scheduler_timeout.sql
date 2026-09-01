-- pg_net defaults to five seconds, which is shorter than a Web Push batch.
CREATE OR REPLACE FUNCTION public.configure_web_push_delivery_schedule(
  p_project_url TEXT,
  p_cron_secret TEXT,
  p_schedule TEXT DEFAULT '* * * * *'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_job_id BIGINT;
  project_secret_id UUID;
  cron_secret_id UUID;
BEGIN
  IF auth.role() NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Only trusted roles can configure push schedule.';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_project_url, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_cron_secret, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Project URL and cron secret are required.';
  END IF;

  SELECT id INTO project_secret_id FROM vault.secrets WHERE name = 'herlink_project_url' ORDER BY created_at DESC LIMIT 1;
  IF project_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_project_url, 'herlink_project_url');
  ELSE
    PERFORM vault.update_secret(project_secret_id, p_project_url, 'herlink_project_url', NULL);
  END IF;

  SELECT id INTO cron_secret_id FROM vault.secrets WHERE name = 'herlink_push_cron_secret' ORDER BY created_at DESC LIMIT 1;
  IF cron_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_cron_secret, 'herlink_push_cron_secret');
  ELSE
    PERFORM vault.update_secret(cron_secret_id, p_cron_secret, 'herlink_push_cron_secret', NULL);
  END IF;

  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'herlink_web_push_delivery_minutely' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'herlink_web_push_delivery_minutely',
    p_schedule,
    $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'herlink_project_url' ORDER BY created_at DESC LIMIT 1) || '/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'herlink_push_cron_secret' ORDER BY created_at DESC LIMIT 1)),
      body := '{"limit":10}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.configure_web_push_delivery_schedule(TEXT, TEXT, TEXT) TO service_role;

DO $$
DECLARE
  project_url TEXT;
  cron_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO project_url FROM vault.decrypted_secrets WHERE name = 'herlink_project_url' ORDER BY created_at DESC LIMIT 1;
  SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets WHERE name = 'herlink_push_cron_secret' ORDER BY created_at DESC LIMIT 1;
  IF project_url IS NOT NULL AND cron_secret IS NOT NULL THEN
    PERFORM public.configure_web_push_delivery_schedule(project_url, cron_secret);
  END IF;
END;
$$;
