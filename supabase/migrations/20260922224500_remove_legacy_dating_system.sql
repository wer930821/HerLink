-- Remove the legacy profile-based dating system. Keep anonymous random chat,
-- anonymous safety, admin tooling, push delivery, and moderation.

DELETE FROM public.push_notification_events
WHERE event_type IN ('new_match', 'new_message');

DROP TRIGGER IF EXISTS herlink_push_notification_on_match ON public.matches;
DROP TRIGGER IF EXISTS herlink_push_notification_on_message ON public.messages;

DROP FUNCTION IF EXISTS public.list_discover_profiles();
DROP FUNCTION IF EXISTS public.list_discover_profiles(integer, integer, text[], text[], text[], boolean, text[], text[], integer, integer, integer, integer, text, uuid);
DROP FUNCTION IF EXISTS public.get_visible_public_profiles(uuid[]);
DROP FUNCTION IF EXISTS public.get_public_primary_photos(uuid[]);
DROP FUNCTION IF EXISTS public.get_public_profile_photos(uuid[]);

DROP VIEW IF EXISTS public.public_profiles;

DROP TABLE IF EXISTS public.match_reads CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.matches CASCADE;
DROP TABLE IF EXISTS public.likes CASCADE;
DROP TABLE IF EXISTS public.profile_photos CASCADE;
DROP TABLE IF EXISTS public.signup_precheck_events;

DROP FUNCTION IF EXISTS public.handle_match_push_notification();
DROP FUNCTION IF EXISTS public.handle_message_push_notification();
DROP FUNCTION IF EXISTS public.like_user(uuid);
DROP FUNCTION IF EXISTS public.list_active_conversations();
DROP FUNCTION IF EXISTS public.mark_match_messages_read(uuid);
DROP FUNCTION IF EXISTS public.send_message(uuid, text);
DROP FUNCTION IF EXISTS public.unmatch_user(uuid);
DROP FUNCTION IF EXISTS public.is_match_member(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.block_user(uuid);
DROP FUNCTION IF EXISTS public.report_user(uuid, text, text);
DROP FUNCTION IF EXISTS public.create_profile_photo(text);
DROP FUNCTION IF EXISTS public.delete_profile_photo(uuid);
DROP FUNCTION IF EXISTS public.reorder_profile_photos(uuid[]);
DROP FUNCTION IF EXISTS public.set_primary_profile_photo(uuid);

DROP FUNCTION IF EXISTS public.list_anonymous_active_conversations();
DROP FUNCTION IF EXISTS public.list_anonymous_discover_profiles(
  integer, integer, text[], text[], text[], boolean, text[], text[], integer,
  integer, integer, integer, integer, text, uuid
);
DROP FUNCTION IF EXISTS public.get_visible_anonymous_profiles(uuid[]);

DROP FUNCTION IF EXISTS public.can_access_profile_photo_object(text) CASCADE;
DROP FUNCTION IF EXISTS public.can_read_profile_photo_object(text, uuid) CASCADE;

ALTER TABLE public.push_notification_events
  DROP COLUMN IF EXISTS match_id,
  DROP COLUMN IF EXISTS message_id;

CREATE OR REPLACE FUNCTION public.get_safe_anonymous_profiles(p_user_ids uuid[])
RETURNS TABLE(
  id uuid,
  anonymous_display_name text,
  anonymous_avatar text,
  anonymous_intro text,
  anonymous_age_visibility text,
  age integer,
  age_display text,
  city text,
  identity_label text,
  relationship_goals text[],
  custom_relationship_goal text,
  interests text[],
  verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    profile.id,
    CASE
      WHEN btrim(COALESCE(profile.anonymous_display_name, '')) ~* '^匿名-[0-9a-f]{12}$' THEN '匿名使用者'
      ELSE COALESCE(NULLIF(btrim(profile.anonymous_display_name), ''), '匿名使用者')
    END,
    CASE
      WHEN NULLIF(btrim(COALESCE(profile.anonymous_avatar, '')), '') IS NOT NULL THEN profile.anonymous_avatar
      ELSE 'avatar_01'
    END,
    NULLIF(btrim(COALESCE(profile.anonymous_intro, '')), ''),
    COALESCE(profile.anonymous_age_visibility, 'hidden'),
    NULL::integer,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text[],
    NULL::text,
    NULL::text[],
    COALESCE(profile.verified, FALSE)
  FROM public.profiles AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]))
    AND profile.id <> auth.uid()
    AND profile.account_status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.profiles actor
      WHERE actor.id = auth.uid() AND actor.account_status = 'active'
    )
    AND NOT public.has_block_between(auth.uid(), profile.id);
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_push_notification(
  p_dedupe_key text,
  p_event_type text,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_match_id uuid,
  p_message_id uuid,
  p_verification_id uuid,
  p_title text,
  p_body text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_session_id uuid DEFAULT NULL::uuid,
  p_delivery_target text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  event_id uuid;
  resolved_target text;
  expected_target text;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_dedupe_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Notification dedupe key is required.';
  END IF;

  IF p_event_type NOT IN ('verification_result', 'push_test', 'random_match', 'random_message') THEN
    RAISE EXCEPTION 'Unsupported push notification event type.';
  END IF;

  expected_target := CASE
    WHEN p_event_type IN ('random_match', 'random_message') THEN 'both'
    ELSE 'native'
  END;

  resolved_target := LOWER(BTRIM(COALESCE(p_delivery_target, expected_target)));
  IF resolved_target NOT IN ('web', 'native', 'both') THEN
    RAISE EXCEPTION 'Unsupported push delivery target.';
  END IF;
  IF resolved_target <> expected_target THEN
    RAISE EXCEPTION 'Push delivery target does not match event type.';
  END IF;

  INSERT INTO public.push_notification_events (
    dedupe_key, event_type, user_id, actor_user_id, verification_id,
    session_id, delivery_target, title, body, payload
  )
  VALUES (
    p_dedupe_key, p_event_type, p_user_id, p_actor_user_id, p_verification_id,
    p_session_id, resolved_target, p_title, p_body, COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT id INTO event_id
    FROM public.push_notification_events
    WHERE dedupe_key = p_dedupe_key;
  END IF;

  RETURN event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_self_push_test_notification()
RETURNS TABLE(event_id uuid, active_token_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  next_event_id uuid := gen_random_uuid();
  token_count integer := 0;
  dedupe_value text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account is not eligible for push testing right now.';
  END IF;

  PERFORM public.assert_rate_limit(
    'push_self_test_notification', 3, 60,
    jsonb_build_object('kind', 'push_test')
  );

  SELECT COUNT(*) INTO token_count
  FROM public.push_tokens
  WHERE user_id = actor_id AND active = TRUE;

  IF token_count <= 0 THEN
    RAISE EXCEPTION 'No active push token is registered for this account.';
  END IF;

  dedupe_value := 'push_test:' || actor_id::text || ':' || replace(clock_timestamp()::text, ' ', 'T');

  INSERT INTO public.push_notification_events (
    id, dedupe_key, event_type, user_id, actor_user_id, verification_id,
    title, body, payload, delivery_target
  )
  VALUES (
    next_event_id, dedupe_value, 'push_test', actor_id, actor_id, NULL,
    'HerLink', '這是一則測試通知',
    jsonb_build_object('kind','push_test','type','push_test'),
    'native'
  );

  event_id := next_event_id;
  active_token_count := token_count;
  RETURN NEXT;
END;
$function$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS bio,
  DROP COLUMN IF EXISTS orientation,
  DROP COLUMN IF EXISTS identity_label,
  DROP COLUMN IF EXISTS relationship_goals,
  DROP COLUMN IF EXISTS interests,
  DROP COLUMN IF EXISTS onboarding_completed,
  DROP COLUMN IF EXISTS interested_in_identity_labels,
  DROP COLUMN IF EXISTS custom_relationship_goal,
  DROP COLUMN IF EXISTS location_latitude,
  DROP COLUMN IF EXISTS location_longitude,
  DROP COLUMN IF EXISTS location_updated_at;

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  profile_row public.profiles%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  PERFORM set_config('herlink.internal_profile_update', 'on', true);

  UPDATE public.profiles
  SET account_status = 'deletion_pending',
      deletion_requested_at = timezone('utc'::text, now())
  WHERE id = actor_id
  RETURNING * INTO profile_row;

  UPDATE public.push_tokens
  SET active = FALSE,
      updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND active = TRUE;

  PERFORM public.leave_random_session(NULL);
  PERFORM public.leave_random_queue();

  RETURN profile_row;
END;
$function$;
