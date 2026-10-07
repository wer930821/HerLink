CREATE OR REPLACE FUNCTION public.set_my_anonymous_display_name(p_name text)
RETURNS TABLE(status text, anonymous_display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_name_key text := lower(v_name);
  v_fixed uuid;
  v_updated text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT afi.fixed_profile_id
  INTO v_fixed
  FROM public.admin_fixed_anonymous_identities AS afi
  WHERE afi.admin_user_id = v_actor;

  IF v_fixed IS NOT NULL AND v_fixed = v_actor THEN
    RETURN QUERY
    SELECT 'FIXED'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_actor;
    RETURN;
  END IF;

  IF v_name = '' OR char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'TOO_SHORT';
  END IF;

  IF char_length(v_name) > 12 THEN
    RAISE EXCEPTION 'TOO_LONG';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id <> v_actor
      AND lower(regexp_replace(trim(coalesce(p.anonymous_display_name, '')), '[[:space:]]+', ' ', 'g')) = v_name_key
  ) THEN
    RETURN QUERY
    SELECT 'NAME_TAKEN'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_actor;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.profiles AS target_profile
    SET anonymous_display_name = v_name
    WHERE target_profile.id = v_actor
    RETURNING target_profile.anonymous_display_name INTO v_updated;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY
    SELECT 'NAME_TAKEN'::text, p.anonymous_display_name
    FROM public.profiles AS p
    WHERE p.id = v_actor;
    RETURN;
  END;

  RETURN QUERY SELECT 'OK'::text, v_updated;
END
$function$;

REVOKE ALL ON FUNCTION public.set_my_anonymous_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_anonymous_display_name(text) TO authenticated, service_role;
