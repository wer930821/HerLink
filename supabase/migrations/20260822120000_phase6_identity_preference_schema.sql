ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interested_in_identity_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS profiles_interested_in_identity_labels_gin_idx
  ON public.profiles
  USING gin (interested_in_identity_labels);

DROP FUNCTION IF EXISTS public.list_discover_profiles(
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

CREATE OR REPLACE FUNCTION public.list_discover_profiles(
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
  display_name TEXT,
  age INTEGER,
  city TEXT,
  bio TEXT,
  orientation TEXT,
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
  filtered AS (
    SELECT
      public_profile.*,
      candidate_profile.interested_in_identity_labels,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(public_profile.interests, ARRAY[]::TEXT[])) AS interest
        WHERE interest = ANY(COALESCE((SELECT interests FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_interest_count,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(public_profile.relationship_goals, ARRAY[]::TEXT[])) AS goal
        WHERE goal = ANY(COALESCE((SELECT relationship_goals FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_goal_count,
      CASE WHEN public_profile.verified THEN 1 ELSE 0 END AS verified_rank,
      SUBSTRING(MD5(auth.uid()::TEXT || ':' || public_profile.id::TEXT || ':' || CURRENT_DATE::TEXT) FROM 1 FOR 16) AS rotation_key
    FROM public.public_profiles AS public_profile
    JOIN public.profiles AS candidate_profile
      ON candidate_profile.id = public_profile.id
    WHERE auth.uid() IS NOT NULL
      AND public_profile.id <> auth.uid()
      AND NOT public.has_block_between(auth.uid(), public_profile.id)
      AND (p_min_age IS NULL OR public_profile.age IS NULL OR public_profile.age >= p_min_age)
      AND (p_max_age IS NULL OR public_profile.age IS NULL OR public_profile.age <= p_max_age)
      AND (
        COALESCE(array_length(p_cities, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(p_cities) AS city_filter
          WHERE lower(trim(city_filter)) = lower(trim(COALESCE(public_profile.city, '')))
        )
      )
      AND (
        COALESCE(array_length(p_relationship_goals, 1), 0) = 0
        OR COALESCE(public_profile.relationship_goals, ARRAY[]::TEXT[]) && p_relationship_goals
      )
      AND (
        COALESCE(array_length(p_interests, 1), 0) = 0
        OR COALESCE(public_profile.interests, ARRAY[]::TEXT[]) && p_interests
      )
      AND (NOT p_verified_only OR public_profile.verified = TRUE)
      AND (
        COALESCE(array_length(p_identity_labels, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(p_identity_labels) AS identity_filter
          WHERE lower(trim(identity_filter)) = lower(trim(COALESCE(public_profile.identity_label, '')))
        )
      )
      AND (
        COALESCE(array_length(p_orientations, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(p_orientations) AS orientation_filter
          WHERE lower(trim(orientation_filter)) = lower(trim(COALESCE(public_profile.orientation, '')))
        )
      )
      AND (
        COALESCE(array_length((SELECT interested_in_identity_labels FROM actor_profile), 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE((SELECT interested_in_identity_labels FROM actor_profile), ARRAY[]::TEXT[])) AS actor_identity_filter
          WHERE lower(trim(actor_identity_filter)) = lower(trim(COALESCE(public_profile.identity_label, '')))
        )
      )
      AND (
        COALESCE(array_length(candidate_profile.interested_in_identity_labels, 1), 0) = 0
        OR NULLIF(trim(COALESCE((SELECT identity_label FROM actor_profile), '')), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(candidate_profile.interested_in_identity_labels, ARRAY[]::TEXT[])) AS candidate_identity_filter
          WHERE lower(trim(candidate_identity_filter)) = lower(trim(COALESCE((SELECT identity_label FROM actor_profile), '')))
        )
      )
  )
  SELECT
    filtered.id,
    filtered.display_name,
    filtered.age,
    filtered.city,
    filtered.bio,
    filtered.orientation,
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

GRANT EXECUTE ON FUNCTION public.list_discover_profiles(
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
) TO authenticated, service_role;
