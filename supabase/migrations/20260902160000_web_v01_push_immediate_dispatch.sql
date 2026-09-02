-- Immediate, asynchronous dispatch for random-chat notifications. pg_net only
-- queues the HTTP request, so a network failure can never block chat/matching.

CREATE OR REPLACE FUNCTION public.dispatch_random_push_event_immediately()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url TEXT;
  cron_secret TEXT;
BEGIN
  IF NEW.status <> 'pending'
    OR NEW.event_type NOT IN ('random_match', 'random_message') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret
    INTO project_url
    FROM vault.decrypted_secrets
    WHERE name = 'herlink_project_url'
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT decrypted_secret
    INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'herlink_push_cron_secret'
    ORDER BY created_at DESC
    LIMIT 1;

    IF project_url IS NULL OR cron_secret IS NULL THEN
      RAISE WARNING 'Immediate random-chat push dispatch skipped for event %: scheduler secret is unavailable.', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := project_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-cron-secret', cron_secret
      ),
      body := jsonb_build_object('eventId', NEW.id, 'limit', 1),
      timeout_milliseconds := 55000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Immediate random-chat push dispatch failed for event % (SQLSTATE %, %)', NEW.id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS herlink_dispatch_random_push_event_immediately ON public.push_notification_events;
CREATE TRIGGER herlink_dispatch_random_push_event_immediately
AFTER INSERT ON public.push_notification_events
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_random_push_event_immediately();
