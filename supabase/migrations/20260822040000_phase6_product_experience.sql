CREATE TABLE IF NOT EXISTS public.match_reads (
  match_id UUID NOT NULL REFERENCES public.matches ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS match_reads_user_id_idx
ON public.match_reads (user_id, updated_at DESC);

ALTER TABLE public.match_reads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.match_reads FROM public, anon;
GRANT SELECT ON public.match_reads TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.match_reads TO service_role;

DROP POLICY IF EXISTS "Users can read their own match read state" ON public.match_reads;
CREATE POLICY "Users can read their own match read state"
ON public.match_reads
FOR SELECT
USING (
  auth.uid() = user_id
  AND public.is_match_member(match_id, auth.uid(), NULL)
);

CREATE OR REPLACE FUNCTION public.get_public_profile_photos(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  user_id UUID,
  storage_path TEXT,
  sort_order INTEGER,
  is_primary BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    photo.id,
    photo.user_id,
    photo.storage_path,
    photo.sort_order,
    photo.is_primary,
    photo.created_at
  FROM public.profile_photos AS photo
  WHERE auth.uid() IS NOT NULL
    AND photo.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]))
    AND photo.moderation_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.public_profiles AS profile
      WHERE profile.id = photo.user_id
        AND profile.id <> auth.uid()
        AND NOT public.has_block_between(auth.uid(), profile.id)
    )
  ORDER BY photo.user_id, photo.is_primary DESC, photo.sort_order, photo.created_at;
$$;

CREATE OR REPLACE FUNCTION public.list_discover_profiles(
  p_min_age INTEGER DEFAULT NULL,
  p_max_age INTEGER DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_relationship_goals TEXT[] DEFAULT NULL,
  p_interests TEXT[] DEFAULT NULL,
  p_verified_only BOOLEAN DEFAULT FALSE,
  p_identity_labels TEXT[] DEFAULT NULL,
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
      COALESCE(profile.relationship_goals, ARRAY[]::TEXT[]) AS relationship_goals,
      COALESCE(profile.interests, ARRAY[]::TEXT[]) AS interests
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
  ),
  filtered AS (
    SELECT
      profile.*,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(profile.interests, ARRAY[]::TEXT[])) AS interest
        WHERE interest = ANY(COALESCE((SELECT interests FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_interest_count,
      COALESCE((
        SELECT COUNT(*)
        FROM unnest(COALESCE(profile.relationship_goals, ARRAY[]::TEXT[])) AS goal
        WHERE goal = ANY(COALESCE((SELECT relationship_goals FROM actor_profile), ARRAY[]::TEXT[]))
      ), 0)::INTEGER AS shared_goal_count,
      CASE WHEN profile.verified THEN 1 ELSE 0 END AS verified_rank,
      SUBSTRING(MD5(auth.uid()::TEXT || ':' || profile.id::TEXT || ':' || CURRENT_DATE::TEXT) FROM 1 FOR 16) AS rotation_key
    FROM public.public_profiles AS profile
    WHERE auth.uid() IS NOT NULL
      AND profile.id <> auth.uid()
      AND NOT public.has_block_between(auth.uid(), profile.id)
      AND (p_min_age IS NULL OR profile.age IS NULL OR profile.age >= p_min_age)
      AND (p_max_age IS NULL OR profile.age IS NULL OR profile.age <= p_max_age)
      AND (
        COALESCE(array_length(p_cities, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(p_cities) AS city_filter
          WHERE lower(trim(city_filter)) = lower(trim(COALESCE(profile.city, '')))
        )
      )
      AND (
        COALESCE(array_length(p_relationship_goals, 1), 0) = 0
        OR COALESCE(profile.relationship_goals, ARRAY[]::TEXT[]) && p_relationship_goals
      )
      AND (
        COALESCE(array_length(p_interests, 1), 0) = 0
        OR COALESCE(profile.interests, ARRAY[]::TEXT[]) && p_interests
      )
      AND (NOT p_verified_only OR profile.verified = TRUE)
      AND (
        COALESCE(array_length(p_identity_labels, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(p_identity_labels) AS identity_filter
          WHERE lower(trim(identity_filter)) = lower(trim(COALESCE(profile.identity_label, '')))
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
      AND filtered.id > p_cursor_id
    )
  )
  ORDER BY
    filtered.shared_interest_count DESC,
    filtered.shared_goal_count DESC,
    filtered.verified_rank DESC,
    filtered.rotation_key ASC,
    filtered.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 30));
$$;

CREATE OR REPLACE FUNCTION public.list_active_conversations()
RETURNS TABLE (
  match_id UUID,
  match_user_1_id UUID,
  match_user_2_id UUID,
  match_status TEXT,
  matched_at TIMESTAMPTZ,
  match_created_at TIMESTAMPTZ,
  other_user_id UUID,
  display_name TEXT,
  age INTEGER,
  city TEXT,
  bio TEXT,
  orientation TEXT,
  identity_label TEXT,
  relationship_goals TEXT[],
  interests TEXT[],
  verified BOOLEAN,
  latest_message_id UUID,
  latest_message_content TEXT,
  latest_message_created_at TIMESTAMPTZ,
  latest_message_sender_id UUID,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_matches AS (
    SELECT
      match.id,
      match.matched_at,
      CASE
        WHEN match.user_1_id = auth.uid() THEN match.user_2_id
        ELSE match.user_1_id
      END AS other_user_id
    FROM public.matches AS match
    WHERE auth.uid() IS NOT NULL
      AND match.status = 'active'
      AND (match.user_1_id = auth.uid() OR match.user_2_id = auth.uid())
  ),
  latest_messages AS (
    SELECT DISTINCT ON (message.match_id)
      message.match_id,
      message.id,
      message.content,
      message.created_at,
      message.sender_id
    FROM public.messages AS message
    JOIN my_matches ON my_matches.id = message.match_id
    ORDER BY message.match_id, message.created_at DESC, message.id DESC
  ),
  my_reads AS (
    SELECT read_state.match_id, read_state.last_read_at
    FROM public.match_reads AS read_state
    WHERE read_state.user_id = auth.uid()
  )
  SELECT
    my_matches.id AS match_id,
    match.user_1_id AS match_user_1_id,
    match.user_2_id AS match_user_2_id,
    match.status AS match_status,
    my_matches.matched_at,
    match.created_at AS match_created_at,
    my_matches.other_user_id,
    profile.display_name,
    profile.age,
    profile.city,
    profile.bio,
    profile.orientation,
    profile.identity_label,
    profile.relationship_goals,
    profile.interests,
    profile.verified,
    latest_messages.id AS latest_message_id,
    latest_messages.content AS latest_message_content,
    latest_messages.created_at AS latest_message_created_at,
    latest_messages.sender_id AS latest_message_sender_id,
    (
      SELECT COUNT(*)
      FROM public.messages AS unread
      WHERE unread.match_id = my_matches.id
        AND unread.sender_id <> auth.uid()
        AND unread.created_at > COALESCE((SELECT my_reads.last_read_at FROM my_reads WHERE my_reads.match_id = my_matches.id), 'epoch'::timestamptz)
    ) AS unread_count
  FROM my_matches
  JOIN public.matches AS match
    ON match.id = my_matches.id
  JOIN public.public_profiles AS profile
    ON profile.id = my_matches.other_user_id
  LEFT JOIN latest_messages
    ON latest_messages.match_id = my_matches.id
  ORDER BY COALESCE(latest_messages.created_at, my_matches.matched_at) DESC, my_matches.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.mark_match_messages_read(p_match_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  updated_rows INTEGER := 0;
  read_at_value TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_match_member(p_match_id, actor_id, 'active') THEN
    RAISE EXCEPTION 'This conversation is not available.';
  END IF;

  INSERT INTO public.match_reads (match_id, user_id, last_read_at, updated_at)
  VALUES (p_match_id, actor_id, read_at_value, read_at_value)
  ON CONFLICT (match_id, user_id)
  DO UPDATE
  SET last_read_at = EXCLUDED.last_read_at,
      updated_at = EXCLUDED.updated_at;

  UPDATE public.messages
  SET read_at = read_at_value
  WHERE match_id = p_match_id
    AND read_at IS NULL
    AND sender_id <> actor_id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_profile_photos(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_discover_profiles(INTEGER, INTEGER, TEXT[], TEXT[], TEXT[], BOOLEAN, TEXT[], INTEGER, INTEGER, INTEGER, INTEGER, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_conversations() TO authenticated, service_role;
