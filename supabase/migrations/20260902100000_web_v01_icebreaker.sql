-- Icebreaker V1 is scoped to an existing random-chat session.  It intentionally
-- does not read from or write to the production matchmaking queue.
CREATE TABLE public.icebreaker_questions (
  code TEXT PRIMARY KEY,
  prompt TEXT NOT NULL CHECK (length(btrim(prompt)) BETWEEN 8 AND 280),
  category TEXT NOT NULL CHECK (length(btrim(category)) BETWEEN 2 AND 40),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.random_chat_sessions
  ADD COLUMN IF NOT EXISTS icebreaker_turn INTEGER NOT NULL DEFAULT 0 CHECK (icebreaker_turn >= 0),
  ADD COLUMN IF NOT EXISTS icebreaker_question_code TEXT,
  ADD COLUMN IF NOT EXISTS icebreaker_advanced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS icebreaker_advanced_by UUID REFERENCES auth.users(id);

CREATE TABLE public.random_session_icebreakers (
  session_id UUID PRIMARY KEY REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL DEFAULT 0 CHECK (turn >= 0),
  question_code TEXT NOT NULL REFERENCES public.icebreaker_questions(code),
  advanced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  advanced_by UUID NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.random_session_icebreaker_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.random_chat_sessions(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('shown', 'advanced')),
  turn INTEGER NOT NULL CHECK (turn >= 0),
  question_code TEXT NOT NULL REFERENCES public.icebreaker_questions(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX random_session_icebreaker_events_session_created_idx
  ON public.random_session_icebreaker_events (session_id, created_at DESC);
CREATE UNIQUE INDEX random_session_icebreaker_events_once_idx
  ON public.random_session_icebreaker_events (session_id, event_type, turn);

-- 128 deterministic, production-safe prompts (16 topics × 8 conversational angles).
INSERT INTO public.icebreaker_questions (code, prompt, category)
SELECT
  topic.code || '-' || template.ordinality,
  format(template.pattern, topic.label),
  topic.category
FROM (VALUES
  ('music', '音樂', '興趣'), ('food', '美食', '生活'), ('travel', '旅行', '體驗'),
  ('film', '電影或影集', '娛樂'), ('book', '書', '興趣'), ('weekend', '週末', '生活'),
  ('hobby', '休閒嗜好', '興趣'), ('coffee', '咖啡或飲料', '生活'), ('place', '城市角落', '生活'),
  ('memory', '美好回憶', '故事'), ('skill', '想學的新技能', '成長'), ('pet', '動物', '生活'),
  ('season', '季節', '偏好'), ('game', '遊戲', '娛樂'), ('routine', '小習慣', '生活'),
  ('dream', '小小夢想', '故事')
) AS topic(code, label, category)
CROSS JOIN unnest(ARRAY[
  '最近有什麼%1$s讓你想推薦給別人？',
  '如果今天只能聊一件和%1$s有關的事，你會選什麼？',
  '你和%1$s最有連結的一個畫面是什麼？',
  '關於%1$s，你最不按牌理出牌的偏好是什麼？',
  '有沒有一件和%1$s有關、讓你笑出來的小事？',
  '如果要用%1$s形容今天的心情，會是哪一種？',
  '你希望別人更了解你哪一點和%1$s有關？',
  '此刻聊%1$s，你最想先分享什麼？'
]) WITH ORDINALITY AS template(pattern, ordinality)
ON CONFLICT (code) DO UPDATE SET prompt = EXCLUDED.prompt, category = EXCLUDED.category, is_active = TRUE;

ALTER TABLE public.random_chat_sessions
  ADD CONSTRAINT random_chat_sessions_icebreaker_question_fk
  FOREIGN KEY (icebreaker_question_code) REFERENCES public.icebreaker_questions(code);

ALTER TABLE public.icebreaker_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.random_session_icebreakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.random_session_icebreaker_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY icebreaker_questions_read_active ON public.icebreaker_questions
  FOR SELECT TO authenticated USING (is_active);
CREATE POLICY random_session_icebreakers_member_read ON public.random_session_icebreakers
  FOR SELECT TO authenticated USING (public.is_random_session_member(session_id, auth.uid()));
CREATE POLICY random_session_icebreaker_events_member_read ON public.random_session_icebreaker_events
  FOR SELECT TO authenticated USING (public.is_random_session_member(session_id, auth.uid()));

-- Choosing by a session-derived offset makes every client see the same first
-- question and gives each session a stable, cycle-without-repetition sequence.
CREATE OR REPLACE FUNCTION public.icebreaker_question_for_turn(p_session_id UUID, p_turn INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  question_count INTEGER;
  question_offset INTEGER;
  selected_code TEXT;
BEGIN
  SELECT count(*) INTO question_count FROM public.icebreaker_questions WHERE is_active;
  IF question_count = 0 THEN RAISE EXCEPTION 'Icebreaker question bank is unavailable.'; END IF;
  question_offset := mod((hashtextextended(p_session_id::TEXT, 17) & 9223372036854775807)::BIGINT + p_turn, question_count);
  SELECT code INTO selected_code
  FROM public.icebreaker_questions
  WHERE is_active
  ORDER BY code
  OFFSET question_offset LIMIT 1;
  RETURN selected_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_random_session_icebreaker(p_session_id UUID)
RETURNS TABLE (session_id UUID, turn INTEGER, question_code TEXT, prompt TEXT, category TEXT, advanced_at TIMESTAMPTZ, advanced_by_me BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor_id UUID := auth.uid(); state_row public.random_session_icebreakers%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.random_chat_sessions s WHERE s.id = p_session_id AND s.status = 'active' AND (s.user_a = actor_id OR s.user_b = actor_id)) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;
  INSERT INTO public.random_session_icebreakers (session_id, turn, question_code, advanced_by)
  VALUES (p_session_id, 0, public.icebreaker_question_for_turn(p_session_id, 0), actor_id)
  ON CONFLICT (session_id) DO NOTHING;
  UPDATE public.random_chat_sessions
  SET icebreaker_turn = 0, icebreaker_question_code = public.icebreaker_question_for_turn(p_session_id, 0), icebreaker_advanced_at = timezone('utc', now()), icebreaker_advanced_by = actor_id
  WHERE id = p_session_id AND icebreaker_question_code IS NULL;
  SELECT * INTO state_row FROM public.random_session_icebreakers WHERE random_session_icebreakers.session_id = p_session_id;
  INSERT INTO public.random_session_icebreaker_events (session_id, actor_id, event_type, turn, question_code)
  SELECT p_session_id, actor_id, 'shown', state_row.turn, state_row.question_code
  ON CONFLICT (session_id, event_type, turn) DO NOTHING;
  RETURN QUERY SELECT state_row.session_id, state_row.turn, state_row.question_code, q.prompt, q.category, state_row.advanced_at, state_row.advanced_by = actor_id
  FROM public.icebreaker_questions q WHERE q.code = state_row.question_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_random_chat_icebreaker(p_session_id UUID)
RETURNS TABLE (session_id UUID, turn INTEGER, question_code TEXT, prompt TEXT, category TEXT, advanced_at TIMESTAMPTZ, advanced_by_me BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor_id UUID := auth.uid(); state_row public.random_session_icebreakers%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.random_chat_sessions s WHERE s.id = p_session_id AND s.status = 'active' AND (s.user_a = actor_id OR s.user_b = actor_id)) THEN
    RAISE EXCEPTION 'This session is not available.';
  END IF;
  PERFORM public.get_random_session_icebreaker(p_session_id);
  SELECT * INTO state_row FROM public.random_session_icebreakers WHERE random_session_icebreakers.session_id = p_session_id FOR UPDATE;
  UPDATE public.random_session_icebreakers
  SET turn = state_row.turn + 1, question_code = public.icebreaker_question_for_turn(p_session_id, state_row.turn + 1), advanced_at = timezone('utc', now()), advanced_by = actor_id
  WHERE random_session_icebreakers.session_id = p_session_id
  RETURNING * INTO state_row;
  UPDATE public.random_chat_sessions
  SET icebreaker_turn = state_row.turn, icebreaker_question_code = state_row.question_code, icebreaker_advanced_at = state_row.advanced_at, icebreaker_advanced_by = actor_id
  WHERE id = p_session_id;
  INSERT INTO public.random_session_icebreaker_events (session_id, actor_id, event_type, turn, question_code)
  VALUES (p_session_id, actor_id, 'advanced', state_row.turn, state_row.question_code), (p_session_id, actor_id, 'shown', state_row.turn, state_row.question_code)
  ON CONFLICT (session_id, event_type, turn) DO NOTHING;
  RETURN QUERY SELECT state_row.session_id, state_row.turn, state_row.question_code, q.prompt, q.category, state_row.advanced_at, TRUE
  FROM public.icebreaker_questions q WHERE q.code = state_row.question_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_random_session_icebreaker_analytics(p_session_id UUID)
RETURNS TABLE (questions_shown BIGINT, questions_advanced BIGINT, latest_turn INTEGER, latest_advanced_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*) FILTER (WHERE event_type = 'shown'), count(*) FILTER (WHERE event_type = 'advanced'), COALESCE(max(turn), 0), max(created_at)
  FROM public.random_session_icebreaker_events
  WHERE session_id = p_session_id AND public.is_random_session_member(p_session_id, auth.uid());
$$;

GRANT SELECT ON public.icebreaker_questions, public.random_session_icebreakers, public.random_session_icebreaker_events TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.get_my_random_session_view(UUID);
CREATE FUNCTION public.get_my_random_session_view(p_session_id UUID DEFAULT NULL)
RETURNS TABLE (id UUID, status TEXT, created_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, ended_reason TEXT, ended_by_me BOOLEAN, partner_anonymous_display_name TEXT, partner_anonymous_avatar TEXT, partner_verified BOOLEAN, partner_age_display TEXT, partner_city TEXT, icebreaker_turn INTEGER, icebreaker_question_code TEXT, icebreaker_prompt TEXT, icebreaker_category TEXT, icebreaker_advanced_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.status, s.created_at, s.ended_at, s.ended_reason, s.ended_by = auth.uid(),
    COALESCE(partner.anonymous_display_name, '匿名使用者'), COALESCE(partner.anonymous_avatar, 'avatar_01'), COALESCE(partner.verified, FALSE), partner.age_display, partner.city,
    COALESCE(i.turn, 0), COALESCE(i.question_code, s.icebreaker_question_code, public.icebreaker_question_for_turn(s.id, 0)), q.prompt, q.category, COALESCE(i.advanced_at, s.icebreaker_advanced_at)
  FROM public.random_chat_sessions s
  LEFT JOIN public.random_session_icebreakers i ON i.session_id = s.id
  LEFT JOIN public.icebreaker_questions q ON q.code = COALESCE(i.question_code, s.icebreaker_question_code, public.icebreaker_question_for_turn(s.id, 0))
  LEFT JOIN LATERAL (SELECT * FROM public.get_safe_anonymous_profiles(ARRAY[CASE WHEN s.user_a = auth.uid() THEN s.user_b ELSE s.user_a END]) LIMIT 1) partner ON TRUE
  WHERE auth.uid() IS NOT NULL AND (p_session_id IS NULL OR s.id = p_session_id) AND (s.user_a = auth.uid() OR s.user_b = auth.uid()) AND (p_session_id IS NOT NULL OR s.status = 'active')
  ORDER BY s.created_at DESC, s.id DESC LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_session_icebreaker(UUID), public.advance_random_chat_icebreaker(UUID), public.get_random_session_icebreaker_analytics(UUID), public.get_my_random_session_view(UUID) TO authenticated, service_role;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.icebreaker_questions WHERE is_active) < 120 THEN RAISE EXCEPTION 'Icebreaker V1 requires at least 120 active questions.'; END IF;
END $$;
