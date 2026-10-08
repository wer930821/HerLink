-- Keep retained anonymous contacts usable after permanent recovery.
-- The current auth UID can change after recovery, but contact rows and chat
-- sessions are owned by the stable anonymous identity.

CREATE OR REPLACE FUNCTION public.request_anonymous_contact(p_session_id uuid)
RETURNS TABLE(contact_id uuid, status text, my_approved boolean, partner_approved boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  s public.random_chat_sessions%rowtype;
  partner_id uuid;
  a uuid;
  b uuid;
  row_ref public.anonymous_contacts%rowtype;
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or device revoked.';
  END IF;

  SELECT *
    INTO s
  FROM public.random_chat_sessions
  WHERE id = p_session_id
    AND (user_a = actor_id OR user_b = actor_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;

  partner_id := CASE WHEN s.user_a = actor_id THEN s.user_b ELSE s.user_a END;

  IF public.has_block_between(actor_id, partner_id) THEN
    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.profiles p
    WHERE p.id IN (actor_id, partner_id)
      AND p.account_status = 'active'
  ) <> 2 THEN
    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  a := least(actor_id, partner_id);
  b := greatest(actor_id, partner_id);

  INSERT INTO public.anonymous_contacts(
    user_a,
    user_b,
    source_session_id,
    requested_by,
    user_a_approved,
    user_b_approved,
    status,
    updated_at
  )
  VALUES (
    a,
    b,
    p_session_id,
    actor_id,
    actor_id = a,
    actor_id = b,
    'pending',
    timezone('utc', now())
  )
  ON CONFLICT (user_a, user_b) DO UPDATE
  SET source_session_id = coalesce(public.anonymous_contacts.source_session_id, excluded.source_session_id),
      requested_by = CASE
        WHEN public.anonymous_contacts.status = 'removed' THEN excluded.requested_by
        ELSE public.anonymous_contacts.requested_by
      END,
      user_a_approved = CASE
        WHEN excluded.user_a_approved THEN true
        WHEN public.anonymous_contacts.status = 'removed' THEN false
        ELSE public.anonymous_contacts.user_a_approved
      END,
      user_b_approved = CASE
        WHEN excluded.user_b_approved THEN true
        WHEN public.anonymous_contacts.status = 'removed' THEN false
        ELSE public.anonymous_contacts.user_b_approved
      END,
      status = 'pending',
      updated_at = timezone('utc', now())
  RETURNING * INTO row_ref;

  IF row_ref.user_a_approved AND row_ref.user_b_approved THEN
    UPDATE public.anonymous_contacts
    SET status = 'active',
        activated_at = coalesce(activated_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    WHERE id = row_ref.id
    RETURNING * INTO row_ref;
  END IF;

  RETURN QUERY
  SELECT row_ref.id,
         row_ref.status,
         CASE WHEN actor_id = row_ref.user_a THEN row_ref.user_a_approved ELSE row_ref.user_b_approved END,
         CASE WHEN actor_id = row_ref.user_a THEN row_ref.user_b_approved ELSE row_ref.user_a_approved END;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_anonymous_contact(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_anonymous_contact(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_anonymous_contact_status(p_session_id uuid)
RETURNS TABLE(contact_id uuid, status text, my_approved boolean, partner_approved boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH actor AS (
    SELECT public.resolve_active_anonymous_chat_identity() AS id
  ),
  session_row AS (
    SELECT s.user_a, s.user_b, actor.id AS actor_id
    FROM public.random_chat_sessions s
    CROSS JOIN actor
    WHERE auth.uid() IS NOT NULL
      AND actor.id IS NOT NULL
      AND s.id = p_session_id
      AND (s.user_a = actor.id OR s.user_b = actor.id)
    LIMIT 1
  )
  SELECT c.id,
         c.status,
         CASE WHEN s.actor_id = c.user_a THEN c.user_a_approved ELSE c.user_b_approved END,
         CASE WHEN s.actor_id = c.user_a THEN c.user_b_approved ELSE c.user_a_approved END
  FROM public.anonymous_contacts c
  JOIN session_row s
    ON c.user_a = least(s.user_a, s.user_b)
   AND c.user_b = greatest(s.user_a, s.user_b)
  WHERE c.status <> 'removed'
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_anonymous_contact_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anonymous_contact_status(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_my_anonymous_contacts();
CREATE FUNCTION public.list_my_anonymous_contacts()
RETURNS TABLE(
  contact_id uuid,
  source_session_id uuid,
  status text,
  partner_user_id uuid,
  partner_anonymous_display_name text,
  partner_anonymous_avatar text,
  partner_verified boolean,
  my_approved boolean,
  partner_approved boolean,
  created_at timestamptz,
  activated_at timestamptz,
  current_session_id uuid,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH actor AS (
    SELECT public.resolve_active_anonymous_chat_identity() AS id
  )
  SELECT c.id,
         c.source_session_id,
         c.status,
         partner.id,
         coalesce(nullif(btrim(partner.anonymous_display_name), ''), '匿名使用者'),
         coalesce(nullif(btrim(partner.anonymous_avatar), ''), 'avatar_01'),
         coalesce(partner.verified, false),
         CASE WHEN actor.id = c.user_a THEN c.user_a_approved ELSE c.user_b_approved END,
         CASE WHEN actor.id = c.user_a THEN c.user_b_approved ELSE c.user_a_approved END,
         c.created_at,
         c.activated_at,
         s.id,
         CASE
           WHEN lm.id IS NULL THEN null
           WHEN lm.message_type = 'image' THEN '傳送了一張照片'
           ELSE left(coalesce(lm.content, ''), 80)
         END,
         lm.created_at,
         coalesce(uc.unread_count, 0)
  FROM actor
  JOIN public.anonymous_contacts c
    ON actor.id IS NOT NULL
   AND (actor.id = c.user_a OR actor.id = c.user_b)
  JOIN public.profiles partner
    ON partner.id = CASE WHEN actor.id = c.user_a THEN c.user_b ELSE c.user_a END
  LEFT JOIN public.random_chat_sessions s
    ON s.user_a = c.user_a
   AND s.user_b = c.user_b
  LEFT JOIN LATERAL (
    SELECT m.id, m.content, m.message_type, m.created_at
    FROM public.random_chat_messages m
    WHERE m.session_id = s.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS unread_count
    FROM public.random_chat_messages m
    LEFT JOIN public.random_chat_session_reads r
      ON r.session_id = s.id
     AND r.user_id = actor.id
    WHERE m.session_id = s.id
      AND m.sender_id <> actor.id
      AND m.created_at > coalesce(r.last_read_at, c.activated_at, c.created_at)
  ) uc ON true
  WHERE auth.uid() IS NOT NULL
    AND c.status <> 'removed'
    AND partner.account_status = 'active'
    AND NOT public.has_block_between(actor.id, partner.id)
  ORDER BY CASE WHEN coalesce(uc.unread_count, 0) > 0 THEN 0 ELSE 1 END,
           coalesce(lm.created_at, c.activated_at, c.updated_at) DESC,
           c.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_my_anonymous_contacts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_my_anonymous_contacts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_anonymous_contact(p_contact_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  changed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or device revoked.';
  END IF;

  UPDATE public.anonymous_contacts
  SET status = 'removed',
      user_a_approved = false,
      user_b_approved = false,
      updated_at = timezone('utc', now())
  WHERE id = p_contact_id
    AND (user_a = actor_id OR user_b = actor_id);

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_anonymous_contact(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_anonymous_contact(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_anonymous_contact_session(p_contact_id uuid)
RETURNS TABLE(status text, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor_id uuid := public.resolve_active_anonymous_chat_identity();
  c public.anonymous_contacts%rowtype;
  partner_id uuid;
  pair_session public.random_chat_sessions%rowtype;
BEGIN
  IF auth.uid() IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required or device revoked.';
  END IF;

  SELECT ac.*
    INTO c
  FROM public.anonymous_contacts ac
  WHERE ac.id = p_contact_id
    AND ac.status = 'active'
    AND ac.user_a_approved = true
    AND ac.user_b_approved = true
    AND (ac.user_a = actor_id OR ac.user_b = actor_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anonymous contact is not active.';
  END IF;

  partner_id := CASE WHEN c.user_a = actor_id THEN c.user_b ELSE c.user_a END;

  IF public.has_block_between(actor_id, partner_id) THEN
    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  SELECT s.*
    INTO pair_session
  FROM public.random_chat_sessions s
  WHERE s.user_a = least(actor_id, partner_id)
    AND s.user_b = greatest(actor_id, partner_id)
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;

  IF FOUND AND pair_session.status = 'active' THEN
    RETURN QUERY SELECT 'existing'::text, pair_session.id;
    RETURN;
  END IF;

  -- Retained contacts are persistent conversations. They may be resumed even
  -- when either participant currently has another active random chat.
  IF pair_session.id IS NOT NULL THEN
    UPDATE public.random_chat_sessions s
    SET status = 'active',
        ended_at = null,
        ended_by = null,
        ended_reason = null
    WHERE s.id = pair_session.id;

    UPDATE public.random_match_queue q
    SET status = 'left',
        matched_session_id = null,
        updated_at = timezone('utc', now())
    WHERE q.user_id IN (actor_id, partner_id)
      AND q.status = 'waiting';

    RETURN QUERY SELECT 'existing'::text, pair_session.id;
    RETURN;
  END IF;

  INSERT INTO public.random_chat_sessions (user_a, user_b, status, created_at)
  VALUES (
    least(actor_id, partner_id),
    greatest(actor_id, partner_id),
    'active',
    timezone('utc', now())
  )
  RETURNING id INTO pair_session.id;

  UPDATE public.random_match_queue q
  SET status = 'left',
      matched_session_id = null,
      updated_at = timezone('utc', now())
  WHERE q.user_id IN (actor_id, partner_id)
    AND q.status = 'waiting';

  RETURN QUERY SELECT 'created'::text, pair_session.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_anonymous_contact_session(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_anonymous_contact_session(uuid) TO authenticated, service_role;
