-- HerLink multi-chat: allow up to three simultaneous anonymous sessions.
DROP INDEX IF EXISTS public.random_chat_sessions_user_a_active_idx;
DROP INDEX IF EXISTS public.random_chat_sessions_user_b_active_idx;

CREATE INDEX IF NOT EXISTS random_chat_sessions_user_a_active_lookup_idx
  ON public.random_chat_sessions (user_a, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS random_chat_sessions_user_b_active_lookup_idx
  ON public.random_chat_sessions (user_b, created_at DESC) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.join_random_match_internal(p_actor_id UUID,p_excluded_user_id UUID DEFAULT NULL)
RETURNS TABLE(status TEXT,session_id UUID,matched_user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor_profile RECORD; candidate_user_id UUID; session_uuid UUID; actor_active_count INTEGER;
BEGIN
  PERFORM public.reconcile_profile_enforcement_status(p_actor_id);
  SELECT p.account_status,p.onboarding_completed,p.anonymous_mode_enabled,p.anonymous_display_name,p.anonymous_avatar
  INTO actor_profile FROM public.profiles p WHERE p.id=p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  IF actor_profile.account_status <> 'active' THEN RAISE EXCEPTION 'Your account is not eligible right now.'; END IF;
  IF NOT COALESCE(actor_profile.onboarding_completed,FALSE) THEN RAISE EXCEPTION 'Complete onboarding first.'; END IF;
  IF NOT COALESCE(actor_profile.anonymous_mode_enabled,FALSE) THEN RAISE EXCEPTION 'Anonymous mode is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_display_name,''))='' THEN RAISE EXCEPTION 'Anonymous display name is required.'; END IF;
  IF btrim(COALESCE(actor_profile.anonymous_avatar,''))='' THEN RAISE EXCEPTION 'Anonymous avatar is required.'; END IF;

  SELECT count(*)::INTEGER INTO actor_active_count FROM public.random_chat_sessions s
  WHERE s.status='active' AND (s.user_a=p_actor_id OR s.user_b=p_actor_id);
  IF actor_active_count>=3 THEN RETURN QUERY SELECT 'limit_reached'::TEXT,NULL::UUID,NULL::UUID; RETURN; END IF;

  INSERT INTO public.random_match_queue(user_id,status,joined_at,updated_at,matched_session_id)
  VALUES(p_actor_id,'waiting',timezone('utc',now()),timezone('utc',now()),NULL)
  ON CONFLICT(user_id) DO UPDATE SET status='waiting',joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at,matched_session_id=NULL;

  SELECT q.user_id INTO candidate_user_id FROM public.random_match_queue q
  JOIN public.profiles p ON p.id=q.user_id
  WHERE q.status='waiting' AND q.user_id<>p_actor_id
    AND (p_excluded_user_id IS NULL OR q.user_id<>p_excluded_user_id)
    AND p.account_status='active' AND COALESCE(p.onboarding_completed,FALSE)
    AND COALESCE(p.anonymous_mode_enabled,FALSE)
    AND btrim(COALESCE(p.anonymous_display_name,''))<>'' AND btrim(COALESCE(p.anonymous_avatar,''))<>''
    AND NOT public.has_block_between(p_actor_id,q.user_id)
    AND (SELECT count(*) FROM public.random_chat_sessions cs WHERE cs.status='active' AND (cs.user_a=q.user_id OR cs.user_b=q.user_id))<3
    AND NOT EXISTS(SELECT 1 FROM public.random_chat_sessions cs WHERE cs.status='active' AND ((cs.user_a=p_actor_id AND cs.user_b=q.user_id) OR (cs.user_a=q.user_id AND cs.user_b=p_actor_id)))
    AND NOT EXISTS(SELECT 1 FROM public.random_pair_history h WHERE h.pair_key=public.random_pair_key(p_actor_id,q.user_id) AND h.matched_at>=timezone('utc',now())-interval '24 hours')
  ORDER BY q.joined_at,q.user_id LIMIT 1 FOR UPDATE OF q SKIP LOCKED;

  IF FOUND THEN
    session_uuid:=gen_random_uuid();
    INSERT INTO public.random_chat_sessions(id,user_a,user_b,status,created_at)
    VALUES(session_uuid,LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),'active',timezone('utc',now()));
    INSERT INTO public.random_pair_history(pair_key,user_a,user_b,matched_at)
    VALUES(public.random_pair_key(p_actor_id,candidate_user_id),LEAST(p_actor_id,candidate_user_id),GREATEST(p_actor_id,candidate_user_id),timezone('utc',now()));
    UPDATE public.random_match_queue SET status='matched',updated_at=timezone('utc',now()),matched_session_id=session_uuid WHERE user_id IN(p_actor_id,candidate_user_id);
    RETURN QUERY SELECT 'matched'::TEXT,session_uuid,candidate_user_id; RETURN;
  END IF;
  RETURN QUERY SELECT 'waiting'::TEXT,NULL::UUID,NULL::UUID;
END; $$;

CREATE OR REPLACE FUNCTION public.list_my_active_random_sessions()
RETURNS TABLE(id UUID,status TEXT,created_at TIMESTAMPTZ,ended_at TIMESTAMPTZ,ended_reason TEXT,ended_by_me BOOLEAN,partner_anonymous_display_name TEXT,partner_anonymous_avatar TEXT,partner_verified BOOLEAN,partner_age_display TEXT,partner_city TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT v.id,v.status,v.created_at,v.ended_at,v.ended_reason,v.ended_by_me,v.partner_anonymous_display_name,v.partner_anonymous_avatar,v.partner_verified,v.partner_age_display,v.partner_city
  FROM public.random_chat_sessions s CROSS JOIN LATERAL public.get_my_random_session_view(s.id) v
  WHERE auth.uid() IS NOT NULL AND s.status='active' AND (s.user_a=auth.uid() OR s.user_b=auth.uid())
  ORDER BY s.created_at DESC LIMIT 3;
$$;
GRANT EXECUTE ON FUNCTION public.list_my_active_random_sessions() TO authenticated,service_role;
