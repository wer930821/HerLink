-- Fix approve_random_session_recovery to handle NULL/invalid requester_user_id gracefully.
-- Previously, if requester_user_id was NULL (old requests created before the column
-- was added) or pointed to a non-existent profile, the restore would fail with a
-- confusing error or corrupt data. Now it validates upfront with a clear message.

create or replace function public.approve_random_session_recovery(p_recovery_code text, p_side text)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_req public.anonymous_session_recovery_requests%rowtype; v_old uuid;
begin
 if auth.uid() is null or not public.can_use_chat_assistant() then raise exception 'admin required'; end if;
 select * into v_req from public.anonymous_session_recovery_requests where recovery_code=upper(trim(p_recovery_code)) and status='pending' and expires_at>now() for update;
 if not found then raise exception 'recovery request unavailable'; end if;
 if p_side not in ('a','b') then raise exception 'invalid side'; end if;

 -- Validate requester identity upfront (fix for "找不到目前 Web 身分")
 if v_req.requester_user_id is null then
   raise exception '恢復失敗：找不到請求者的身分（requester_user_id 為空），請使用者重新申請恢復碼。';
 end if;
 if not exists(select 1 from public.profiles where id = v_req.requester_user_id) then
   raise exception '恢復失敗：請求者的身分不存在，請使用者重新申請恢復碼。';
 end if;

 select case when p_side='a' then user_a else user_b end into v_old from public.random_chat_sessions where id=v_req.session_id and status='active' for update;
 if v_old is null then raise exception 'session unavailable'; end if;
 if exists(select 1 from public.random_chat_sessions where id=v_req.session_id and (user_a=v_req.requester_user_id or user_b=v_req.requester_user_id)) then
   update public.anonymous_session_recovery_requests set status='approved',resolved_at=now() where id=v_req.id; return true;
 end if;
 update public.random_chat_sessions set user_a=case when p_side='a' then v_req.requester_user_id else user_a end,user_b=case when p_side='b' then v_req.requester_user_id else user_b end where id=v_req.session_id;
 update public.random_chat_messages set sender_id=v_req.requester_user_id where session_id=v_req.session_id and sender_id=v_old;
 update public.anonymous_session_recovery_requests set status='approved',resolved_at=now() where id=v_req.id;
 return true;
end $$;
