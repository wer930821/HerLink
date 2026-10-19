begin;

create or replace function public.station_operator_messages(p_thread_id uuid)
returns table(sender_role text, body text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select m.sender_role, m.body, m.created_at
  from public.station_mail_messages m
  where m.thread_id = p_thread_id
  order by m.created_at;
$$;

create or replace function public.station_operator_reply_and_finish(
  p_job_id uuid,
  p_claim_token uuid,
  p_body text,
  p_result jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.station_operator_jobs%rowtype;
  v_latest uuid;
  v_admin uuid;
  v_message uuid;
begin
  if char_length(trim(coalesce(p_body,''))) < 1 or char_length(trim(p_body)) > 2000 then
    raise exception 'invalid body';
  end if;

  select * into v_job
  from public.station_operator_jobs
  where id = p_job_id and status = 'processing' and claim_token = p_claim_token
  for update;

  if not found then
    raise exception 'job not claimable';
  end if;

  select m.id into v_latest
  from public.station_mail_messages m
  where m.thread_id = v_job.thread_id and m.sender_role = 'user'
  order by m.created_at desc
  limit 1;

  if v_latest is distinct from v_job.trigger_message_id then
    raise exception 'stale context';
  end if;

  select a.user_id into v_admin
  from public.admin_users a
  where a.active = true
  order by a.created_at nulls last, a.user_id
  limit 1;

  if v_admin is null then
    raise exception 'no active admin';
  end if;

  insert into public.station_mail_messages(thread_id, sender_user_id, sender_role, body)
  values(v_job.thread_id, v_admin, 'admin', trim(p_body))
  returning id into v_message;

  update public.station_mail_threads
  set status='replied', updated_at=now(), admin_last_read_at=now(), user_last_read_at=null
  where id=v_job.thread_id;

  insert into public.station_operator_audit(job_id, thread_id, action, outcome, details)
  values(v_job.id, v_job.thread_id, 'reply', 'sent', jsonb_build_object('message_id',v_message));

  update public.station_operator_jobs
  set status='completed', result=coalesce(p_result,'{}'::jsonb), last_error=null,
      claim_token=null, claimed_at=null, updated_at=now()
  where id=v_job.id;

  return v_message;
end;
$$;

revoke execute on function public.station_operator_messages(uuid) from public, anon, authenticated;
revoke execute on function public.station_operator_reply_and_finish(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.station_operator_messages(uuid) to service_role;
grant execute on function public.station_operator_reply_and_finish(uuid,uuid,text,jsonb) to service_role;

commit;
