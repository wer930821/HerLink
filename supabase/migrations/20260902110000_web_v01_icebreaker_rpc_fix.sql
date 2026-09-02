-- PL/pgSQL output-column variables share names with the target table columns.
-- Unqualified ON CONFLICT targets therefore raise 42702 at runtime.
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
  ON CONFLICT ON CONSTRAINT random_session_icebreakers_pkey DO NOTHING;
  UPDATE public.random_chat_sessions
  SET icebreaker_turn = 0, icebreaker_question_code = public.icebreaker_question_for_turn(p_session_id, 0), icebreaker_advanced_at = timezone('utc', now()), icebreaker_advanced_by = actor_id
  WHERE id = p_session_id AND icebreaker_question_code IS NULL;
  SELECT * INTO state_row FROM public.random_session_icebreakers WHERE random_session_icebreakers.session_id = p_session_id;
  INSERT INTO public.random_session_icebreaker_events (session_id, actor_id, event_type, turn, question_code)
  SELECT p_session_id, actor_id, 'shown', state_row.turn, state_row.question_code
  ON CONFLICT DO NOTHING;
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
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT state_row.session_id, state_row.turn, state_row.question_code, q.prompt, q.category, state_row.advanced_at, TRUE
  FROM public.icebreaker_questions q WHERE q.code = state_row.question_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_random_session_icebreaker(UUID), public.advance_random_chat_icebreaker(UUID) TO authenticated, service_role;
