CREATE OR REPLACE FUNCTION public.get_my_random_session_view(p_session_id UUID DEFAULT NULL)
RETURNS TABLE(
  id UUID,
  status TEXT,
  created_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  ended_by_me BOOLEAN,
  partner_anonymous_display_name TEXT,
  partner_anonymous_avatar TEXT,
  partner_verified BOOLEAN,
  partner_age_display TEXT,
  partner_city TEXT,
  icebreaker_turn INTEGER,
  icebreaker_question_code TEXT,
  icebreaker_prompt TEXT,
  icebreaker_category TEXT,
  icebreaker_advanced_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH actor AS (SELECT public.resolve_active_anonymous_chat_identity() AS id)
  SELECT
    s.id,
    s.status,
    s.created_at,
    s.ended_at,
    s.ended_reason,
    s.ended_by = actor.id,
    COALESCE(partner.anonymous_display_name, '匿名使用者'),
    COALESCE(partner.anonymous_avatar, 'avatar_01'),
    COALESCE(partner.verified, FALSE),
    partner.age_display,
    partner.city,
    COALESCE(i.turn, 0),
    COALESCE(i.question_code, s.icebreaker_question_code, public.icebreaker_question_for_turn(s.id, 0)),
    q.prompt,
    q.category,
    COALESCE(i.advanced_at, s.icebreaker_advanced_at)
  FROM actor
  JOIN public.random_chat_sessions s
    ON actor.id IS NOT NULL
   AND (s.user_a = actor.id OR s.user_b = actor.id)
  LEFT JOIN public.random_session_icebreakers i ON i.session_id = s.id
  LEFT JOIN public.icebreaker_questions q ON q.code = COALESCE(i.question_code, s.icebreaker_question_code, public.icebreaker_question_for_turn(s.id, 0))
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.get_safe_anonymous_profiles(ARRAY[CASE WHEN s.user_a = actor.id THEN s.user_b ELSE s.user_a END])
    LIMIT 1
  ) partner ON TRUE
  WHERE auth.uid() IS NOT NULL
    AND (p_session_id IS NULL OR s.id = p_session_id)
    AND (p_session_id IS NOT NULL OR s.status = 'active')
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_my_active_random_sessions()
RETURNS TABLE(
  id UUID,
  status TEXT,
  created_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  ended_by_me BOOLEAN,
  partner_anonymous_display_name TEXT,
  partner_anonymous_avatar TEXT,
  partner_verified BOOLEAN,
  partner_age_display TEXT,
  partner_city TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH actor AS (SELECT public.resolve_active_anonymous_chat_identity() AS id)
  SELECT
    v.id,
    v.status,
    v.created_at,
    v.ended_at,
    v.ended_reason,
    v.ended_by_me,
    v.partner_anonymous_display_name,
    v.partner_anonymous_avatar,
    v.partner_verified,
    v.partner_age_display,
    v.partner_city
  FROM actor
  JOIN public.random_chat_sessions s
    ON actor.id IS NOT NULL
   AND s.status = 'active'
   AND (s.user_a = actor.id OR s.user_b = actor.id)
  CROSS JOIN LATERAL public.get_my_random_session_view(s.id) v
  WHERE auth.uid() IS NOT NULL
  ORDER BY s.created_at DESC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_random_session_view(UUID), public.list_my_active_random_sessions() TO authenticated, service_role;
