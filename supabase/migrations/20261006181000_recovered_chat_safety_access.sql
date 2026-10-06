-- Restore the public chat RPC contracts expected by the Web client while routing
-- authorization and attribution through the recovered stable anonymous identity.
DROP FUNCTION IF EXISTS public.list_random_messages(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.send_random_message(UUID, TEXT);
DROP FUNCTION IF EXISTS public.report_random_user(UUID, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.check_random_action_rate_limit(p_action_key TEXT,p_limit_count INTEGER,p_window INTERVAL,p_context JSONB DEFAULT '{}'::jsonb)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id UUID:=public.resolve_active_anonymous_chat_identity(); recent_count INTEGER:=0;
BEGIN
 IF auth.uid() IS NULL OR actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF;
 IF btrim(COALESCE(p_action_key,''))='' OR COALESCE(p_limit_count,0)<1 OR COALESCE(p_window,INTERVAL '0 seconds')<=INTERVAL '0 seconds' THEN RAISE EXCEPTION 'Invalid rate limit.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('herlink.random.rate:'||actor_id::TEXT||':'||p_action_key,0));
 SELECT COUNT(*) INTO recent_count FROM public.random_action_rate_limit_events e WHERE e.user_id=actor_id AND e.action_key=p_action_key AND e.created_at>=timezone('utc'::text,now())-p_window;
 IF recent_count>=p_limit_count THEN RAISE EXCEPTION 'Rate limit exceeded.'; END IF;
 INSERT INTO public.random_action_rate_limit_events(user_id,action_key,context,created_at) VALUES(actor_id,p_action_key,COALESCE(p_context,'{}'::jsonb),timezone('utc'::text,now()));
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_random_session_view(p_session_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID,status TEXT,created_at TIMESTAMPTZ,ended_at TIMESTAMPTZ,ended_reason TEXT,ended_by_me BOOLEAN,partner_anonymous_display_name TEXT,partner_anonymous_avatar TEXT,partner_verified BOOLEAN,partner_age_display TEXT,partner_city TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH actor AS (SELECT public.resolve_active_anonymous_chat_identity() AS id)
 SELECT s.id,s.status,s.created_at,s.ended_at,s.ended_reason,s.ended_by=a.id,
        COALESCE(partner.anonymous_display_name,'匿名使用者'),COALESCE(partner.anonymous_avatar,'avatar_01'),COALESCE(partner.verified,FALSE),partner.age_display,partner.city
 FROM actor a JOIN public.random_chat_sessions s ON a.id IS NOT NULL AND(s.user_a=a.id OR s.user_b=a.id)
 LEFT JOIN LATERAL(SELECT * FROM public.get_safe_anonymous_profiles(ARRAY[CASE WHEN s.user_a=a.id THEN s.user_b ELSE s.user_a END]) LIMIT 1)partner ON TRUE
 WHERE auth.uid() IS NOT NULL AND(p_session_id IS NULL OR s.id=p_session_id)AND(p_session_id IS NOT NULL OR s.status='active') ORDER BY s.created_at DESC,s.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_random_messages(p_session_id UUID,p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID,session_id UUID,content TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN,risk_level TEXT,risk_types TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id UUID:=public.resolve_active_anonymous_chat_identity(); max_limit INTEGER:=LEAST(GREATEST(COALESCE(p_limit,100),1),200);
BEGIN
 IF auth.uid() IS NULL OR actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF;
 PERFORM public.reconcile_profile_enforcement_status(actor_id); IF NOT public.is_profile_eligible(actor_id) THEN RAISE EXCEPTION 'Your account is not available.'; END IF;
 IF NOT public.is_active_random_session_member(p_session_id,NULL) THEN RAISE EXCEPTION 'This session is not available.'; END IF;
 RETURN QUERY SELECT m.id,m.session_id,m.content,m.created_at,m.sender_id=actor_id,COALESCE(m.risk_level,'low'),COALESCE(m.risk_types,'{}'::TEXT[]) FROM public.random_chat_messages m WHERE m.session_id=p_session_id ORDER BY m.created_at,m.id LIMIT max_limit;
END; $$;

CREATE OR REPLACE FUNCTION public.send_random_message(p_session_id UUID,p_content TEXT)
RETURNS TABLE(id UUID,session_id UUID,content TEXT,created_at TIMESTAMPTZ,is_mine BOOLEAN,risk_level TEXT,risk_types TEXT[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor_id UUID:=public.resolve_active_anonymous_chat_identity();
 cleaned_content TEXT:=btrim(COALESCE(p_content,''));
 detected_risk_level TEXT:='low';
 detected_risk_types TEXT[]:=ARRAY[]::TEXT[];
 repeated_message BOOLEAN:=FALSE;
 inserted_message_id UUID;
 inserted_created_at TIMESTAMPTZ;
BEGIN
 IF auth.uid() IS NULL OR actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF;
 IF cleaned_content='' THEN RAISE EXCEPTION 'Message cannot be blank.'; END IF;
 IF length(cleaned_content)>2000 THEN RAISE EXCEPTION 'Message is too long.'; END IF;
 PERFORM public.reconcile_profile_enforcement_status(actor_id);
 IF NOT public.is_profile_eligible(actor_id) THEN RAISE EXCEPTION 'Your account is not available.'; END IF;
 IF NOT public.is_active_random_session_member(p_session_id,'active') THEN RAISE EXCEPTION 'This session is not available.'; END IF;
 PERFORM public.check_random_action_rate_limit('send_random_message',5,INTERVAL '10 seconds',jsonb_build_object('session_id',p_session_id::TEXT));
 SELECT r.risk_level,r.risk_types INTO detected_risk_level,detected_risk_types FROM public.analyze_random_message_risk(cleaned_content) r;
 SELECT EXISTS(
   SELECT 1 FROM public.random_chat_messages m
   WHERE m.session_id=p_session_id AND m.sender_id=actor_id AND m.content=cleaned_content
     AND m.created_at>=timezone('utc'::text,now())-INTERVAL '30 seconds'
 ) INTO repeated_message;
 IF repeated_message THEN
   detected_risk_types:=array_append(detected_risk_types,'repeated_message');
   IF detected_risk_level='low' THEN detected_risk_level:='medium'; END IF;
 END IF;
 SELECT COALESCE(array_agg(item),ARRAY[]::TEXT[]) INTO detected_risk_types
 FROM (SELECT DISTINCT item FROM unnest(detected_risk_types) AS item ORDER BY item) deduped_types;
 INSERT INTO public.random_chat_messages(session_id,sender_id,content,risk_level,risk_types)
 VALUES(p_session_id,actor_id,cleaned_content,detected_risk_level,detected_risk_types)
 RETURNING random_chat_messages.id,random_chat_messages.created_at INTO inserted_message_id,inserted_created_at;
 IF detected_risk_level<>'low' THEN
   INSERT INTO public.fraud_risk_events(user_id,session_id,message_id,risk_level,risk_types,created_at)
   VALUES(actor_id,p_session_id,inserted_message_id,detected_risk_level,detected_risk_types,COALESCE(inserted_created_at,timezone('utc'::text,now())));
 END IF;
 RETURN QUERY SELECT inserted_message_id,p_session_id,cleaned_content,inserted_created_at,TRUE,detected_risk_level,detected_risk_types;
END; $$;

CREATE OR REPLACE FUNCTION public.report_random_user(p_session_id UUID,p_category TEXT,p_description TEXT DEFAULT NULL,p_block BOOLEAN DEFAULT FALSE)
RETURNS TABLE(report_id UUID,report_status TEXT,created_at TIMESTAMPTZ,blocked BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id UUID:=public.resolve_active_anonymous_chat_identity(); target RECORD; target_id UUID; description TEXT:=NULLIF(BTRIM(COALESCE(p_description,'')),''); block_result RECORD;
BEGIN
 IF auth.uid() IS NULL OR actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required or device revoked.'; END IF; IF p_session_id IS NULL THEN RAISE EXCEPTION 'Session is required.'; END IF;
 IF p_category NOT IN('suspected_male_impersonation','stolen_photo','scam','money_request','investment_scam','harassment','sexual_harassment','threat','unsolicited_explicit_content','impersonation','suspected_minor','other','spam','sexual_content','fraud') THEN RAISE EXCEPTION 'Unsupported report category.'; END IF;
 IF description IS NOT NULL AND length(description)>500 THEN RAISE EXCEPTION 'Report description is too long.'; END IF;
 SELECT s.user_a,s.user_b INTO target FROM public.random_chat_sessions s WHERE s.id=p_session_id AND(s.user_a=actor_id OR s.user_b=actor_id)LIMIT 1; IF NOT FOUND THEN RAISE EXCEPTION 'This session is not available.'; END IF;
 target_id:=CASE WHEN target.user_a=actor_id THEN target.user_b ELSE target.user_a END;
 PERFORM public.check_random_action_rate_limit('report_random_user',5,INTERVAL '10 minutes',jsonb_build_object('session_id',p_session_id::TEXT,'category',p_category));
 SELECT r.id,r.status,r.created_at INTO report_id,report_status,created_at FROM public.reports r WHERE r.reporter_id=actor_id AND r.reported_user_id=target_id AND r.category=p_category AND COALESCE(r.description,'')=COALESCE(description,'')AND r.created_at>=timezone('utc'::text,now())-INTERVAL '24 hours' ORDER BY r.created_at DESC LIMIT 1;
 IF NOT FOUND THEN INSERT INTO public.reports(reporter_id,reported_user_id,category,description,status)VALUES(actor_id,target_id,p_category,description,'pending')RETURNING reports.id,reports.status,reports.created_at INTO report_id,report_status,created_at; END IF;
 blocked:=FALSE; IF p_block THEN BEGIN SELECT b.blocked,b.session_ended INTO block_result FROM public.block_random_user(p_session_id)b; blocked:=COALESCE(block_result.blocked,FALSE); EXCEPTION WHEN OTHERS THEN blocked:=FALSE; END; END IF; RETURN NEXT;
END; $$;

GRANT EXECUTE ON FUNCTION public.check_random_action_rate_limit(TEXT,INTEGER,INTERVAL,JSONB),public.get_my_random_session_view(UUID),public.list_random_messages(UUID,INTEGER),public.send_random_message(UUID,TEXT),public.report_random_user(UUID,TEXT,TEXT,BOOLEAN) TO authenticated,service_role;
