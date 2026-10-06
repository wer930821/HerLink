CREATE OR REPLACE FUNCTION public.get_my_effective_profile()
RETURNS TABLE(
  id UUID,
  anonymous_mode_enabled BOOLEAN,
  anonymous_display_name TEXT,
  anonymous_avatar TEXT,
  account_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    p.id,
    p.anonymous_mode_enabled,
    p.anonymous_display_name,
    p.anonymous_avatar,
    p.account_status
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = COALESCE(public.resolve_active_anonymous_chat_identity(), auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_effective_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_effective_profile() TO authenticated, service_role;
