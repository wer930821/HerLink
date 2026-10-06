CREATE OR REPLACE FUNCTION public.claim_anonymous_identity_device(p_identity_id UUID,p_new_auth_user_id UUID)
RETURNS TABLE (anonymous_identity_id UUID, active_auth_user_id UUID, generation BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_state public.anonymous_identity_device_state%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_identity_id AND anonymous_mode_enabled=true) THEN RAISE EXCEPTION 'ANONYMOUS_IDENTITY_NOT_FOUND'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_new_auth_user_id AND anonymous_mode_enabled=true) THEN RAISE EXCEPTION 'REPLACEMENT_ANONYMOUS_PROFILE_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_identity_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_new_auth_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.anonymous_identity_device_state s WHERE s.active_auth_user_id=p_new_auth_user_id AND s.anonymous_identity_id<>p_identity_id) THEN RAISE EXCEPTION 'AUTH_USER_ALREADY_BOUND'; END IF;
  SELECT * INTO v_state FROM public.anonymous_identity_device_state s WHERE s.anonymous_identity_id=p_identity_id FOR UPDATE;
  IF v_state.anonymous_identity_id IS NULL THEN
    INSERT INTO public.anonymous_identity_device_state(anonymous_identity_id,active_auth_user_id,generation) VALUES(p_identity_id,p_new_auth_user_id,1) RETURNING * INTO v_state;
  ELSE
    UPDATE public.anonymous_identity_device_state s SET active_auth_user_id=p_new_auth_user_id,generation=s.generation+1,updated_at=timezone('utc'::text,now()) WHERE s.anonymous_identity_id=p_identity_id RETURNING * INTO v_state;
  END IF;
  RETURN QUERY SELECT v_state.anonymous_identity_id,v_state.active_auth_user_id,v_state.generation;
END; $$;
REVOKE ALL ON FUNCTION public.claim_anonymous_identity_device(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_anonymous_identity_device(UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_anonymous_recovery_and_device(p_code_hash TEXT,p_new_auth_user_id UUID,p_new_code_hash TEXT,p_new_code_hint TEXT)
RETURNS TABLE (anonymous_identity_id UUID,anonymous_display_name TEXT,created_at TIMESTAMPTZ,generation BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_credential public.anonymous_recovery_credentials%ROWTYPE; v_state public.anonymous_identity_device_state%ROWTYPE; v_name TEXT; v_now TIMESTAMPTZ:=timezone('utc'::text,now()); v_created TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_credential FROM public.anonymous_recovery_credentials c WHERE c.code_hash=p_code_hash AND c.used_at IS NULL AND c.revoked_at IS NULL LIMIT 1 FOR UPDATE;
  IF v_credential.id IS NULL THEN RAISE EXCEPTION 'INVALID_RECOVERY_CODE'; END IF;
  IF v_credential.anonymous_identity_id=p_new_auth_user_id THEN RAISE EXCEPTION 'SAME_IDENTITY'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_new_auth_user_id AND p.anonymous_mode_enabled=true) THEN RAISE EXCEPTION 'REPLACEMENT_ANONYMOUS_PROFILE_NOT_FOUND'; END IF;
  SELECT p.anonymous_display_name INTO v_name FROM public.profiles p WHERE p.id=v_credential.anonymous_identity_id AND p.anonymous_mode_enabled=true FOR UPDATE;
  IF v_name IS NULL THEN RAISE EXCEPTION 'IDENTITY_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_credential.anonymous_identity_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_new_auth_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.anonymous_identity_device_state s WHERE s.active_auth_user_id=p_new_auth_user_id AND s.anonymous_identity_id<>v_credential.anonymous_identity_id) THEN RAISE EXCEPTION 'AUTH_USER_ALREADY_BOUND'; END IF;
  UPDATE public.anonymous_recovery_credentials c SET used_at=v_now,last_used_at=v_now WHERE c.id=v_credential.id;
  INSERT INTO public.anonymous_recovery_credentials(anonymous_identity_id,code_hash,code_hint,version,rotated_at) VALUES(v_credential.anonymous_identity_id,p_new_code_hash,p_new_code_hint,v_credential.version+1,v_now) RETURNING anonymous_recovery_credentials.created_at INTO v_created;
  SELECT * INTO v_state FROM public.anonymous_identity_device_state s WHERE s.anonymous_identity_id=v_credential.anonymous_identity_id FOR UPDATE;
  IF v_state.anonymous_identity_id IS NULL THEN
    INSERT INTO public.anonymous_identity_device_state(anonymous_identity_id,active_auth_user_id,generation) VALUES(v_credential.anonymous_identity_id,p_new_auth_user_id,1) RETURNING * INTO v_state;
  ELSE
    UPDATE public.anonymous_identity_device_state s SET active_auth_user_id=p_new_auth_user_id,generation=s.generation+1,updated_at=v_now WHERE s.anonymous_identity_id=v_credential.anonymous_identity_id RETURNING * INTO v_state;
  END IF;
  RETURN QUERY SELECT v_credential.anonymous_identity_id,v_name,v_created,v_state.generation;
END; $$;
REVOKE ALL ON FUNCTION public.claim_anonymous_recovery_and_device(TEXT,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_anonymous_recovery_and_device(TEXT,UUID,TEXT,TEXT) TO service_role;
