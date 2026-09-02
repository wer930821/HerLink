-- Run after migrations in a disposable Supabase/Postgres database.
BEGIN;

DO $$
DECLARE first_code TEXT; repeated_code TEXT; next_code TEXT; queue_mentions INTEGER;
BEGIN
  IF (SELECT count(*) FROM public.icebreaker_questions WHERE is_active) < 120 THEN
    RAISE EXCEPTION 'expected at least 120 active Icebreaker questions';
  END IF;

  SELECT public.icebreaker_question_for_turn('00000000-0000-0000-0000-000000000001', 0) INTO first_code;
  SELECT public.icebreaker_question_for_turn('00000000-0000-0000-0000-000000000001', 0) INTO repeated_code;
  SELECT public.icebreaker_question_for_turn('00000000-0000-0000-0000-000000000001', 1) INTO next_code;
  IF first_code IS NULL OR first_code <> repeated_code OR first_code = next_code THEN
    RAISE EXCEPTION 'question selection must be deterministic and advance through the bank';
  END IF;

  SELECT count(*) INTO queue_mentions
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_random_session_icebreaker', 'advance_random_chat_icebreaker')
    AND pg_get_functiondef(p.oid) ILIKE '%random_match_queue%';
  IF queue_mentions <> 0 THEN
    RAISE EXCEPTION 'Icebreaker RPCs must not touch random_match_queue';
  END IF;
END $$;

ROLLBACK;
