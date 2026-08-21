CREATE TABLE IF NOT EXISTS public.likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT likes_no_self_like CHECK (from_user_id <> to_user_id),
  CONSTRAINT likes_unique_direction UNIQUE (from_user_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS likes_to_user_id_idx ON public.likes (to_user_id);
CREATE INDEX IF NOT EXISTS likes_from_user_id_idx ON public.likes (from_user_id);

CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_1_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  user_2_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  matched_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT matches_status_valid CHECK (status IN ('active', 'unmatched', 'blocked')),
  CONSTRAINT matches_canonical_pair CHECK (user_1_id < user_2_id),
  CONSTRAINT matches_unique_pair UNIQUE (user_1_id, user_2_id)
);

CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches (status);
CREATE INDEX IF NOT EXISTS matches_user_1_id_idx ON public.matches (user_1_id);
CREATE INDEX IF NOT EXISTS matches_user_2_id_idx ON public.matches (user_2_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  read_at TIMESTAMPTZ,
  CONSTRAINT messages_type_valid CHECK (type IN ('text')),
  CONSTRAINT messages_content_not_blank CHECK (length(btrim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS messages_match_created_at_idx ON public.messages (match_id, created_at);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS messages_match_unread_idx ON public.messages (match_id, read_at);

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_profile_eligible(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND account_status = 'active'
      AND onboarding_completed = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_match_member(
  p_match_id UUID,
  p_user_id UUID,
  p_required_status TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE id = p_match_id
      AND (user_1_id = p_user_id OR user_2_id = p_user_id)
      AND (p_required_status IS NULL OR status = p_required_status)
  );
$$;

CREATE OR REPLACE FUNCTION public.like_user(target_user_id UUID)
RETURNS TABLE (liked BOOLEAN, matched BOOLEAN, match_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  canonical_user_1 UUID;
  canonical_user_2 UUID;
  existing_match RECORD;
  reverse_like_exists BOOLEAN := FALSE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF actor_id = target_user_id THEN
    RAISE EXCEPTION 'You cannot like yourself.';
  END IF;

  IF NOT public.is_profile_eligible(actor_id) THEN
    RAISE EXCEPTION 'Your account is not eligible to like right now.';
  END IF;

  IF NOT public.is_profile_eligible(target_user_id) THEN
    RAISE EXCEPTION 'Target user is not available.';
  END IF;

  canonical_user_1 := LEAST(actor_id, target_user_id);
  canonical_user_2 := GREATEST(actor_id, target_user_id);

  PERFORM pg_advisory_xact_lock(hashtextextended(canonical_user_1::text || ':' || canonical_user_2::text, 0));

  SELECT id, status
  INTO existing_match
  FROM public.matches
  WHERE user_1_id = canonical_user_1
    AND user_2_id = canonical_user_2;

  IF FOUND THEN
    IF existing_match.status = 'active' THEN
      RETURN QUERY SELECT TRUE, TRUE, existing_match.id;
      RETURN;
    END IF;

    RAISE EXCEPTION 'This connection is no longer available.';
  END IF;

  INSERT INTO public.likes (from_user_id, to_user_id)
  VALUES (actor_id, target_user_id)
  ON CONFLICT (from_user_id, to_user_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE from_user_id = target_user_id
      AND to_user_id = actor_id
  )
  INTO reverse_like_exists;

  IF reverse_like_exists THEN
    INSERT INTO public.matches (user_1_id, user_2_id, status, matched_at)
    VALUES (canonical_user_1, canonical_user_2, 'active', timezone('utc'::text, now()))
    ON CONFLICT (user_1_id, user_2_id) DO NOTHING
    RETURNING id INTO match_id;

    IF match_id IS NULL THEN
      SELECT id, status
      INTO existing_match
      FROM public.matches
      WHERE user_1_id = canonical_user_1
        AND user_2_id = canonical_user_2;

      IF existing_match.status = 'active' THEN
        match_id := existing_match.id;
      ELSE
        RAISE EXCEPTION 'This connection is no longer available.';
      END IF;
    END IF;

    RETURN QUERY SELECT TRUE, TRUE, match_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, FALSE, NULL::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmatch_user(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  updated_rows INTEGER := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.matches
  SET status = 'unmatched'
  WHERE id = p_match_id
    AND status = 'active'
    AND (user_1_id = actor_id OR user_2_id = actor_id);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END;
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
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.messages
  SET read_at = timezone('utc'::text, now())
  WHERE match_id = p_match_id
    AND read_at IS NULL
    AND sender_id <> actor_id
    AND public.is_match_member(p_match_id, actor_id, 'active');

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

REVOKE ALL ON public.likes FROM public, anon;
REVOKE ALL ON public.matches FROM public, anon;
REVOKE ALL ON public.messages FROM public, anon;

GRANT SELECT ON public.likes TO authenticated, service_role;
GRANT SELECT ON public.matches TO authenticated, service_role;
GRANT SELECT, INSERT ON public.messages TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_profile_eligible(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_match_member(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.like_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unmatch_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_match_messages_read(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can see sent and received likes" ON public.likes;
CREATE POLICY "Users can see sent and received likes"
ON public.likes
FOR SELECT
USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

DROP POLICY IF EXISTS "Users can read their matches" ON public.matches;
CREATE POLICY "Users can read their matches"
ON public.matches
FOR SELECT
USING (auth.uid() = user_1_id OR auth.uid() = user_2_id);

DROP POLICY IF EXISTS "Users can read active match messages" ON public.messages;
CREATE POLICY "Users can read active match messages"
ON public.messages
FOR SELECT
USING (public.is_match_member(match_id, auth.uid(), 'active'));

DROP POLICY IF EXISTS "Users can send messages to active matches" ON public.messages;
CREATE POLICY "Users can send messages to active matches"
ON public.messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND type = 'text'
  AND length(btrim(content)) > 0
  AND public.is_match_member(match_id, auth.uid(), 'active')
);
