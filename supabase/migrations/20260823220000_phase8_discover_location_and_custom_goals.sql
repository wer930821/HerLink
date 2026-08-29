ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_relationship_goal TEXT,
  ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_custom_relationship_goal_length_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_custom_relationship_goal_length_check
  CHECK (
    custom_relationship_goal IS NULL
    OR (
      char_length(btrim(custom_relationship_goal)) >= 2
      AND char_length(btrim(custom_relationship_goal)) <= 30
    )
  );

UPDATE public.profiles
SET
  custom_relationship_goal = NULL,
  relationship_goals = COALESCE((
    SELECT array_agg(DISTINCT normalized_goal ORDER BY normalized_goal)
    FROM (
      SELECT CASE
        WHEN raw_goal IS NULL OR btrim(raw_goal) = '' THEN NULL
        WHEN lower(btrim(raw_goal)) = 'chat' OR btrim(raw_goal) = '聊聊天' THEN 'Chat'
        WHEN lower(btrim(raw_goal)) = 'friends' OR btrim(raw_goal) = '認識新朋友' OR btrim(raw_goal) = '交朋友' THEN 'Friends'
        WHEN lower(btrim(raw_goal)) = 'takeitslow' OR btrim(raw_goal) = '慢慢認識' THEN 'TakeItSlow'
        WHEN lower(btrim(raw_goal)) = 'chatpartner' OR btrim(raw_goal) = '找固定聊天對象' THEN 'ChatPartner'
        WHEN lower(btrim(raw_goal)) = 'dating' OR btrim(raw_goal) = '約會' OR btrim(raw_goal) = '短期關係' THEN 'Dating'
        WHEN lower(btrim(raw_goal)) = 'relationship' OR btrim(raw_goal) = '穩定交往' THEN 'Relationship'
        WHEN lower(btrim(raw_goal)) = 'longtermpartner' OR btrim(raw_goal) = '長期伴侶' OR btrim(raw_goal) = '長期關係' THEN 'LongTermPartner'
        WHEN lower(btrim(raw_goal)) = 'sameinterests' OR btrim(raw_goal) = '找同興趣的人' THEN 'SameInterests'
        WHEN lower(btrim(raw_goal)) = 'kpopbuddy' OR btrim(raw_goal) = '找一起追星的人' THEN 'KpopBuddy'
        WHEN lower(btrim(raw_goal)) = 'foodbuddy' OR btrim(raw_goal) = '找飯友' THEN 'FoodBuddy'
        WHEN lower(btrim(raw_goal)) = 'moviebuddy' OR btrim(raw_goal) = '找電影咖' THEN 'MovieBuddy'
        WHEN lower(btrim(raw_goal)) = 'travelbuddy' OR btrim(raw_goal) = '找旅伴' THEN 'TravelBuddy'
        WHEN lower(btrim(raw_goal)) = 'gowithflow' OR btrim(raw_goal) = '看緣分' OR btrim(raw_goal) = '不確定' THEN 'GoWithFlow'
        WHEN lower(btrim(raw_goal)) = 'other' OR btrim(raw_goal) = '其他' THEN 'Other'
        ELSE NULL
      END AS normalized_goal
      FROM unnest(COALESCE(relationship_goals, ARRAY[]::TEXT[])) AS raw_goal
    ) normalized_goals
    WHERE normalized_goal IS NOT NULL
  ), ARRAY[]::TEXT[]);

DROP FUNCTION IF EXISTS public.get_safe_anonymous_profiles(UUID[]);

CREATE OR REPLACE FUNCTION public.get_safe_anonymous_profiles(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  anonymous_display_name TEXT,
  anonymous_avatar TEXT,
  anonymous_intro TEXT,
  anonymous_age_visibility TEXT,
  age INTEGER,
  age_display TEXT,
  city TEXT,
  identity_label TEXT,
  relationship_goals TEXT[],
  custom_relationship_goal TEXT,
  interests TEXT[],
  verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate_base AS (
    SELECT
      profile.*,
      date_part('year', age(profile.birthday::timestamp with time zone))::INTEGER AS derived_age
    FROM public.profiles AS profile
  )
  SELECT
    profile.id,
    COALESCE(NULLIF(btrim(profile.anonymous_display_name), ''), '匿名使用者') AS anonymous_display_name,
    CASE
      WHEN NULLIF(btrim(COALESCE(profile.anonymous_avatar, '')), '') IS NOT NULL THEN profile.anonymous_avatar
      ELSE 'avatar_01'
    END AS anonymous_avatar,
    NULLIF(btrim(COALESCE(profile.anonymous_intro, '')), '') AS anonymous_intro,
    COALESCE(profile.anonymous_age_visibility, 'range') AS anonymous_age_visibility,
    CASE WHEN profile.anonymous_age_visibility = 'exact' THEN profile.derived_age ELSE NULL END AS age,
    CASE
      WHEN COALESCE(profile.anonymous_age_visibility, 'range') = 'hidden' THEN NULL
      WHEN COALESCE(profile.anonymous_age_visibility, 'range') = 'exact' THEN profile.derived_age::TEXT
      WHEN profile.derived_age BETWEEN 18 AND 20 THEN '18–20 歲'
      WHEN profile.derived_age BETWEEN 21 AND 24 THEN '21–24 歲'
      WHEN profile.derived_age BETWEEN 25 AND 29 THEN '25–29 歲'
      WHEN profile.derived_age BETWEEN 30 AND 34 THEN '30–34 歲'
      WHEN profile.derived_age BETWEEN 35 AND 39 THEN '35–39 歲'
      WHEN profile.derived_age BETWEEN 40 AND 44 THEN '40–44 歲'
      WHEN profile.derived_age >= 45 THEN '45+'
      ELSE NULL
    END AS age_display,
    profile.city,
    profile.identity_label,
    profile.relationship_goals,
    NULLIF(btrim(COALESCE(profile.custom_relationship_goal, '')), '') AS custom_relationship_goal,
    profile.interests,
    profile.verified
  FROM candidate_base AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND profile.id <> auth.uid()
    AND profile.account_status IN ('active', 'deletion_pending');
$$;

GRANT EXECUTE ON FUNCTION public.get_safe_anonymous_profiles(UUID[]) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_visible_anonymous_profiles(UUID[]);

CREATE OR REPLACE FUNCTION public.get_visible_anonymous_profiles(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  anonymous_display_name TEXT,
  anonymous_avatar TEXT,
  anonymous_age_visibility TEXT,
  age INTEGER,
  age_display TEXT,
  city TEXT,
  anonymous_intro TEXT,
  identity_label TEXT,
  relationship_goals TEXT[],
  custom_relationship_goal TEXT,
  interests TEXT[],
  verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate_base AS (
    SELECT
      profile.*,
      date_part('year', age(profile.birthday::timestamp with time zone))::INTEGER AS derived_age
    FROM public.profiles AS profile
  )
  SELECT
    profile.id,
    profile.anonymous_display_name,
    profile.anonymous_avatar,
    profile.anonymous_age_visibility,
    CASE WHEN profile.anonymous_age_visibility = 'exact' THEN profile.derived_age ELSE NULL END AS age,
    CASE
      WHEN profile.anonymous_age_visibility = 'hidden' THEN NULL
      WHEN profile.anonymous_age_visibility = 'exact' THEN profile.derived_age::TEXT
      WHEN profile.derived_age BETWEEN 18 AND 20 THEN '18–20 歲'
      WHEN profile.derived_age BETWEEN 21 AND 24 THEN '21–24 歲'
      WHEN profile.derived_age BETWEEN 25 AND 29 THEN '25–29 歲'
      WHEN profile.derived_age BETWEEN 30 AND 34 THEN '30–34 歲'
      WHEN profile.derived_age BETWEEN 35 AND 39 THEN '35–39 歲'
      WHEN profile.derived_age BETWEEN 40 AND 44 THEN '40–44 歲'
      WHEN profile.derived_age >= 45 THEN '45+'
      ELSE NULL
    END AS age_display,
    profile.city,
    NULLIF(btrim(COALESCE(profile.anonymous_intro, '')), '') AS anonymous_intro,
    profile.identity_label,
    profile.relationship_goals,
    NULLIF(btrim(COALESCE(profile.custom_relationship_goal, '')), '') AS custom_relationship_goal,
    profile.interests,
    profile.verified
  FROM candidate_base AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND profile.id <> auth.uid()
    AND profile.account_status = 'active'
    AND profile.onboarding_completed = TRUE
    AND profile.anonymous_mode_enabled = TRUE
    AND profile.anonymous_display_name IS NOT NULL
    AND btrim(profile.anonymous_display_name) <> ''
    AND profile.anonymous_avatar IS NOT NULL
    AND btrim(COALESCE(profile.city, '')) <> ''
    AND profile.identity_label IS NOT NULL
    AND COALESCE(array_length(profile.interested_in_identity_labels, 1), 0) > 0
    AND (
      btrim(COALESCE(profile.anonymous_intro, '')) <> ''
      OR COALESCE(array_length(profile.interests, 1), 0) > 0
    )
    AND NOT public.has_block_between(auth.uid(), profile.id);
$$;

GRANT EXECUTE ON FUNCTION public.get_visible_anonymous_profiles(UUID[]) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_anonymous_discover_profiles(
  INTEGER,
  INTEGER,
  TEXT[],
  TEXT[],
  TEXT[],
  BOOLEAN,
  TEXT[],
  TEXT[],
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  UUID
);

CREATE OR REPLACE FUNCTION public.list_anonymous_discover_profiles(
  p_min_age INTEGER DEFAULT NULL,
  p_max_age INTEGER DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_relationship_goals TEXT[] DEFAULT NULL,
  p_interests TEXT[] DEFAULT NULL,
  p_verified_only BOOLEAN DEFAULT FALSE,
  p_identity_labels TEXT[] DEFAULT NULL,
  p_orientations TEXT[] DEFAULT NULL,
  p_max_distance_km INTEGER DEFAULT NULL,
  p_limit INTEGER DEFAULT 12,
  p_cursor_interest_count INTEGER DEFAULT NULL,
  p_cursor_goal_count INTEGER DEFAULT NULL,
  p_cursor_verified_rank INTEGER DEFAULT NULL,
  p_cursor_rotation_key TEXT DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  anonymous_display_name TEXT,
  anonymous_avatar TEXT,
  anonymous_age_visibility TEXT,
  age INTEGER,
  age_display TEXT,
  city TEXT,
  anonymous_intro TEXT,
  identity_label TEXT,
  relationship_goals TEXT[],
  custom_relationship_goal TEXT,
  interests TEXT[],
  verified BOOLEAN,
  distance_km INTEGER,
  sort_interest_count INTEGER,
  sort_goal_count INTEGER,
  sort_verified_rank INTEGER,
  sort_rotation_key TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor_profile AS (
    SELECT
      profile.identity_label,
      COALESCE(profile.interested_in_identity_labels, ARRAY[]::TEXT[]) AS interested_in_identity_labels,
      COALESCE(profile.relationship_goals, ARRAY[]::TEXT[]) AS relationship_goals,
      COALESCE(profile.interests, ARRAY[]::TEXT[]) AS interests,
      profile.location_latitude,
      profile.location_longitude
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
  ),
  candidate_base AS (
    SELECT
      candidate.*,
      date_part('year', age(candidate.birthday::timestamp with time zone))::INTEGER AS derived_age
    FROM public.profiles AS candidate
  ),
  filtered AS (
    SELECT
      candidate.id,
      candidate.anonymous_display_name,
      candidate.anonymous_avatar,
      candidate.anonymous_age_visibility,
      CASE WHEN candidate.anonymous_age_visibility = 'exact' THEN candidate.derived_age ELSE NULL END AS age,
      CASE
        WHEN candidate.anonymous_age_visibility = 'hidden' THEN NULL
        WHEN candidate.anonymous_age_visibility = 'exact' THEN candidate.derived_age::TEXT
        WHEN candidate.derived_age BETWEEN 18 AND 20 THEN '18–20 歲'
        WHEN candidate.derived_age BETWEEN 21 AND 24 THEN '21–24 歲'
        WHEN candidate.derived_age BETWEEN 25 AND 29 THEN '25–29 歲'
        WHEN candidate.derived_age BETWEEN 30 AND 34 THEN '30–34 歲'
        WHEN candidate.derived_age BETWEEN 35 AND 39 THEN '35–39 歲'
        WHEN candidate.derived_age BETWEEN 40 AND 44 THEN '40–44 歲'
        WHEN candidate.derived_age >= 45 THEN '45+'
        ELSE NULL
      END AS age_display,
      candidate.city,
      NULLIF(btrim(COALESCE(candidate.anonymous_intro, '')), '') AS anonymous_intro,
      candidate.identity_label,
      candidate.relationship_goals,
      NULLIF(btrim(COALESCE(candidate.custom_relationship_goal, '')), '') AS custom_relationship_goal,
      candidate.interests,
      candidate.verified,
      CASE
        WHEN (SELECT location_latitude FROM actor_profile) IS NULL
          OR (SELECT location_longitude FROM actor_profile) IS NULL
          OR candidate.location_latitude IS NULL
          OR candidate.location_longitude IS NULL
        THEN NULL
        ELSE GREATEST(
          0,
          ROUND(
            6371 * 2 * ASIN(
              SQRT(
                POWER(SIN(RADIANS(candidate.location_latitude - (SELECT location_latitude FROM actor_profile)) / 2), 2)
                + COS(RADIANS((SELECT location_latitude FROM actor_profile)))
                * COS(RADIANS(candidate.location_latitude))
                * POWER(SIN(RADIANS(candidate.location_longitude - (SELECT location_longitude FROM actor_profile)) / 2), 2)
              )
            )
          )::INTEGER
        )
      END AS distance_km,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(candidate.interests, ARRAY[]::TEXT[])) AS interest
        WHERE interest = ANY(COALESCE((SELECT interests FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_interest_count,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(candidate.relationship_goals, ARRAY[]::TEXT[])) AS goal
        WHERE goal = ANY(COALESCE((SELECT relationship_goals FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_goal_count,
      CASE WHEN candidate.verified THEN 1 ELSE 0 END AS verified_rank,
      SUBSTRING(MD5(auth.uid()::TEXT || ':' || candidate.id::TEXT || ':' || CURRENT_DATE::TEXT) FROM 1 FOR 16) AS rotation_key
    FROM candidate_base AS candidate
    WHERE auth.uid() IS NOT NULL
      AND candidate.id <> auth.uid()
      AND candidate.account_status = 'active'
      AND candidate.onboarding_completed = TRUE
      AND candidate.anonymous_mode_enabled = TRUE
      AND candidate.anonymous_display_name IS NOT NULL
      AND btrim(candidate.anonymous_display_name) <> ''
      AND candidate.anonymous_avatar IS NOT NULL
      AND btrim(COALESCE(candidate.city, '')) <> ''
      AND candidate.identity_label IS NOT NULL
      AND COALESCE(array_length(candidate.interested_in_identity_labels, 1), 0) > 0
      AND (
        btrim(COALESCE(candidate.anonymous_intro, '')) <> ''
        OR COALESCE(array_length(candidate.interests, 1), 0) > 0
      )
      AND NOT public.has_block_between(auth.uid(), candidate.id)
      AND (p_min_age IS NULL OR candidate.derived_age IS NULL OR candidate.derived_age >= p_min_age)
      AND (p_max_age IS NULL OR candidate.derived_age IS NULL OR candidate.derived_age <= p_max_age)
      AND (
        COALESCE(array_length(p_relationship_goals, 1), 0) = 0
        OR COALESCE(candidate.relationship_goals, ARRAY[]::TEXT[]) && p_relationship_goals
      )
      AND (
        COALESCE(array_length(p_interests, 1), 0) = 0
        OR COALESCE(candidate.interests, ARRAY[]::TEXT[]) && p_interests
      )
      AND (NOT p_verified_only OR candidate.verified = TRUE)
      AND (
        COALESCE(array_length(p_identity_labels, 1), 0) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(p_identity_labels) AS identity_filter
          WHERE lower(trim(identity_filter)) = lower(trim(COALESCE(candidate.identity_label, '')))
        )
      )
      AND (
        COALESCE(array_length((SELECT interested_in_identity_labels FROM actor_profile), 1), 0) > 0
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE((SELECT interested_in_identity_labels FROM actor_profile), ARRAY[]::TEXT[])) AS actor_identity_filter
          WHERE lower(trim(actor_identity_filter)) = lower(trim(COALESCE(candidate.identity_label, '')))
        )
      )
      AND (
        COALESCE(array_length(candidate.interested_in_identity_labels, 1), 0) > 0
        AND NULLIF(trim(COALESCE((SELECT identity_label FROM actor_profile), '')), '') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(candidate.interested_in_identity_labels, ARRAY[]::TEXT[])) AS candidate_identity_filter
          WHERE lower(trim(candidate_identity_filter)) = lower(trim(COALESCE((SELECT identity_label FROM actor_profile), '')))
        )
      )
      AND (
        p_max_distance_km IS NULL
        OR (SELECT location_latitude FROM actor_profile) IS NULL
        OR (SELECT location_longitude FROM actor_profile) IS NULL
        OR (
          candidate.location_latitude IS NOT NULL
          AND candidate.location_longitude IS NOT NULL
          AND 6371 * 2 * ASIN(
            SQRT(
              POWER(SIN(RADIANS(candidate.location_latitude - (SELECT location_latitude FROM actor_profile)) / 2), 2)
              + COS(RADIANS((SELECT location_latitude FROM actor_profile)))
              * COS(RADIANS(candidate.location_latitude))
              * POWER(SIN(RADIANS(candidate.location_longitude - (SELECT location_longitude FROM actor_profile)) / 2), 2)
            )
          ) <= p_max_distance_km
        )
      )
  )
  SELECT
    filtered.id,
    filtered.anonymous_display_name,
    filtered.anonymous_avatar,
    filtered.anonymous_age_visibility,
    filtered.age,
    filtered.age_display,
    filtered.city,
    filtered.anonymous_intro,
    filtered.identity_label,
    filtered.relationship_goals,
    filtered.custom_relationship_goal,
    filtered.interests,
    filtered.verified,
    filtered.distance_km,
    filtered.shared_interest_count AS sort_interest_count,
    filtered.shared_goal_count AS sort_goal_count,
    filtered.verified_rank AS sort_verified_rank,
    filtered.rotation_key AS sort_rotation_key
  FROM filtered
  WHERE (
    p_cursor_id IS NULL
    OR filtered.shared_interest_count < COALESCE(p_cursor_interest_count, filtered.shared_interest_count)
    OR (
      filtered.shared_interest_count = COALESCE(p_cursor_interest_count, filtered.shared_interest_count)
      AND filtered.shared_goal_count < COALESCE(p_cursor_goal_count, filtered.shared_goal_count)
    )
    OR (
      filtered.shared_interest_count = COALESCE(p_cursor_interest_count, filtered.shared_interest_count)
      AND filtered.shared_goal_count = COALESCE(p_cursor_goal_count, filtered.shared_goal_count)
      AND filtered.verified_rank < COALESCE(p_cursor_verified_rank, filtered.verified_rank)
    )
    OR (
      filtered.shared_interest_count = COALESCE(p_cursor_interest_count, filtered.shared_interest_count)
      AND filtered.shared_goal_count = COALESCE(p_cursor_goal_count, filtered.shared_goal_count)
      AND filtered.verified_rank = COALESCE(p_cursor_verified_rank, filtered.verified_rank)
      AND filtered.rotation_key > COALESCE(p_cursor_rotation_key, filtered.rotation_key)
    )
    OR (
      filtered.shared_interest_count = COALESCE(p_cursor_interest_count, filtered.shared_interest_count)
      AND filtered.shared_goal_count = COALESCE(p_cursor_goal_count, filtered.shared_goal_count)
      AND filtered.verified_rank = COALESCE(p_cursor_verified_rank, filtered.verified_rank)
      AND filtered.rotation_key = COALESCE(p_cursor_rotation_key, filtered.rotation_key)
      AND filtered.id > COALESCE(p_cursor_id, filtered.id)
    )
  )
  ORDER BY
    filtered.shared_interest_count DESC,
    filtered.shared_goal_count DESC,
    filtered.verified_rank DESC,
    filtered.rotation_key ASC,
    filtered.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.list_anonymous_discover_profiles(
  INTEGER,
  INTEGER,
  TEXT[],
  TEXT[],
  TEXT[],
  BOOLEAN,
  TEXT[],
  TEXT[],
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  UUID
) TO authenticated, service_role;
