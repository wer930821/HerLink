ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_identity_label_valid_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_interested_in_identity_labels_valid_check;

UPDATE public.profiles
SET identity_label = CASE
  WHEN identity_label IS NULL OR btrim(identity_label) = '' THEN NULL
  WHEN upper(btrim(identity_label)) = 'T' THEN 'T'
  WHEN upper(btrim(identity_label)) = 'P' THEN 'P'
  WHEN upper(btrim(identity_label)) = 'H' THEN 'H'
  WHEN lower(btrim(identity_label)) IN ('other', '其他') THEN 'Other'
  WHEN lower(btrim(identity_label)) IN ('woman', 'non-binary', 'nonbinary', 'trans woman', 'transwoman') THEN 'Other'
  WHEN btrim(identity_label) IN ('女性', '非二元', '跨性別女性') THEN 'Other'
  ELSE NULL
END;

UPDATE public.profiles
SET interested_in_identity_labels = COALESCE((
  SELECT array_agg(DISTINCT normalized_value ORDER BY normalized_value)
  FROM (
    SELECT CASE
      WHEN raw_value IS NULL OR btrim(raw_value) = '' THEN NULL
      WHEN upper(btrim(raw_value)) = 'T' THEN 'T'
      WHEN upper(btrim(raw_value)) = 'P' THEN 'P'
      WHEN upper(btrim(raw_value)) = 'H' THEN 'H'
      WHEN lower(btrim(raw_value)) IN ('other', '其他') THEN 'Other'
      WHEN lower(btrim(raw_value)) IN ('woman', 'non-binary', 'nonbinary', 'trans woman', 'transwoman') THEN 'Other'
      WHEN btrim(raw_value) IN ('女性', '非二元', '跨性別女性') THEN 'Other'
      ELSE NULL
    END AS normalized_value
    FROM unnest(COALESCE(interested_in_identity_labels, ARRAY[]::TEXT[])) AS raw_value
  ) normalized
  WHERE normalized_value IS NOT NULL
), ARRAY[]::TEXT[]);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_identity_label_valid_check
  CHECK (
    identity_label IS NULL
    OR identity_label IN ('T', 'P', 'H', 'Other')
  );

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_interested_in_identity_labels_valid_check
  CHECK (
    interested_in_identity_labels <@ ARRAY['T', 'P', 'H', 'Other']::TEXT[]
  );

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
    profile.interests,
    profile.verified
  FROM candidate_base AS profile
  WHERE auth.uid() IS NOT NULL
    AND profile.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND profile.id <> auth.uid()
    AND profile.account_status IN ('active', 'deletion_pending');
$$;

GRANT EXECUTE ON FUNCTION public.get_safe_anonymous_profiles(UUID[]) TO authenticated, service_role;

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
  interests TEXT[],
  verified BOOLEAN,
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
      COALESCE(profile.interests, ARRAY[]::TEXT[]) AS interests
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
      candidate.interests,
      candidate.verified,
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
        COALESCE(array_length(p_cities, 1), 0) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(p_cities) AS city_filter
          WHERE lower(trim(city_filter)) = lower(trim(COALESCE(candidate.city, '')))
        )
      )
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
        COALESCE(array_length((SELECT interested_in_identity_labels FROM actor_profile), 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE((SELECT interested_in_identity_labels FROM actor_profile), ARRAY[]::TEXT[])) AS actor_identity_filter
          WHERE lower(trim(actor_identity_filter)) = lower(trim(COALESCE(candidate.identity_label, '')))
        )
      )
      AND (
        COALESCE(array_length(candidate.interested_in_identity_labels, 1), 0) = 0
        OR NULLIF(trim(COALESCE((SELECT identity_label FROM actor_profile), '')), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(candidate.interested_in_identity_labels, ARRAY[]::TEXT[])) AS candidate_identity_filter
          WHERE lower(trim(candidate_identity_filter)) = lower(trim(COALESCE((SELECT identity_label FROM actor_profile), '')))
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
    filtered.interests,
    filtered.verified,
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

GRANT EXECUTE ON FUNCTION public.list_anonymous_discover_profiles(INTEGER, INTEGER, TEXT[], TEXT[], TEXT[], BOOLEAN, TEXT[], TEXT[], INTEGER, INTEGER, INTEGER, INTEGER, TEXT, UUID) TO authenticated, service_role;

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
