-- Web Push V1: subscriptions + delivery audit + RPCs + delivery scheduler.
-- Reuses the existing push_notification_events queue; adds a web channel.

-- 1) web_push_subscriptions -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_active_idx
  ON public.web_push_subscriptions (user_id, revoked_at, created_at DESC);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.web_push_subscriptions FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_push_subscriptions TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can view own web push subscriptions"
  ON public.web_push_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can add own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can add own web push subscriptions"
  ON public.web_push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can update own web push subscriptions"
  ON public.web_push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can delete own web push subscriptions"
  ON public.web_push_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Active admins can read all web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Active admins can read all web push subscriptions"
  ON public.web_push_subscriptions
  FOR SELECT
  USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

-- 2) web_push_deliveries (server audit; no client write) ---------------------
CREATE TABLE IF NOT EXISTS public.web_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.push_notification_events(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.web_push_subscriptions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'revoked', 'skipped')),
  provider_status INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS web_push_deliveries_created_idx
  ON public.web_push_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS web_push_deliveries_event_idx
  ON public.web_push_deliveries (event_id);

CREATE INDEX IF NOT EXISTS web_push_deliveries_user_status_idx
  ON public.web_push_deliveries (user_id, status, created_at DESC);

ALTER TABLE public.web_push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.web_push_deliveries FROM public, anon, authenticated;
GRANT SELECT ON public.web_push_deliveries TO authenticated, service_role;

DROP POLICY IF EXISTS "Active admins can read all web push deliveries" ON public.web_push_deliveries;
CREATE POLICY "Active admins can read all web push deliveries"
  ON public.web_push_deliveries
  FOR SELECT
  USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

-- 3) push_notification_events: session linkage + admin visibility ------------
ALTER TABLE public.push_notification_events
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS push_notification_events_session_idx
  ON public.push_notification_events (session_id);

GRANT SELECT ON public.push_notification_events TO authenticated;

DROP POLICY IF EXISTS "Active admins can read all push notification events" ON public.push_notification_events;
CREATE POLICY "Active admins can read all push notification events"
  ON public.push_notification_events
  FOR SELECT
  USING (public.is_active_admin(ARRAY['reviewer', 'moderator', 'admin']));

-- 4) RPCs --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_web_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  normalized_endpoint TEXT;
  sub_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  normalized_endpoint := btrim(COALESCE(p_endpoint, ''));
  IF normalized_endpoint = '' THEN
    RAISE EXCEPTION 'Push endpoint is required.';
  END IF;

  IF normalized_endpoint !~ '^https://' AND normalized_endpoint !~ '^http://localhost' THEN
    RAISE EXCEPTION 'Invalid push endpoint.';
  END IF;

  IF length(btrim(COALESCE(p_p256dh, ''))) < 32 OR length(btrim(COALESCE(p_auth, ''))) < 10 THEN
    RAISE EXCEPTION 'Invalid push keys.';
  END IF;

  INSERT INTO public.web_push_subscriptions (
    user_id, endpoint, p256dh, auth_key, user_agent,
    updated_at, last_used_at, revoked_at
  )
  VALUES (
    actor_id, normalized_endpoint, btrim(p_p256dh), btrim(p_auth),
    NULLIF(btrim(COALESCE(p_user_agent, '')), ''),
    timezone('utc'::text, now()), timezone('utc'::text, now()), NULL
  )
  ON CONFLICT (endpoint) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth_key = EXCLUDED.auth_key,
      user_agent = COALESCE(EXCLUDED.user_agent, public.web_push_subscriptions.user_agent),
      updated_at = timezone('utc'::text, now()),
      last_used_at = timezone('utc'::text, now()),
      revoked_at = NULL
  RETURNING id INTO sub_id;

  RETURN sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_web_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_web_push_subscription(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.web_push_subscriptions
  SET revoked_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_id
    AND user_id = actor_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_web_push_subscription(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_web_push_subscription_by_endpoint(p_endpoint TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.web_push_subscriptions
  SET revoked_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE endpoint = btrim(COALESCE(p_endpoint, ''))
    AND user_id = actor_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_web_push_subscription_by_endpoint(TEXT) TO authenticated, service_role;

-- 5) delivery scheduler (pg_cron -> send-push; secret stays in vault) --------
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
BEGIN
  IF auth.role() NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Only trusted roles can configure push schedule.';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_project_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Project URL is required.';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_cron_secret, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Cron secret is required.';
  END IF;

  PERFORM vault.create_secret(p_project_url, 'herlink_project_url');
  PERFORM vault.create_secret(p_cron_secret, 'herlink_push_cron_secret');

  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'herlink_web_push_delivery_minutely'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'herlink_web_push_delivery_minutely',
    p_schedule,
    $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'herlink_project_url'
        ORDER BY created_at DESC
        LIMIT 1
      ) || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'herlink_push_cron_secret'
          ORDER BY created_at DESC
          LIMIT 1
        )
      ),
      body := '{"limit":50}'::jsonb
    );
    $cron$
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.configure_web_push_delivery_schedule(TEXT, TEXT, TEXT) TO service_role;
