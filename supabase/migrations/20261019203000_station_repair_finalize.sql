begin;

create or replace function public.station_operator_finalize_verified_repair(
  p_repair_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repair public.station_operator_repairs%rowtype;
  v_latest_user_message_id uuid;
  v_message_id uuid;
begin
  select * into v_repair
  from public.station_operator_repairs
  where id = p_repair_id
  for update;

  if not found then raise exception 'repair not found'; end if;

  if v_repair.status = 'completed' then
    return jsonb_build_object('status','completed','changed',false);
  end if;

  if v_repair.status <> 'verifying' then
    raise exception 'repair not verifying';
  end if;

  select m.id into v_latest_user_message_id
  from public.station_mail_messages m
  where m.thread_id = v_repair.thread_id
    and m.sender_role = 'user'
  order by m.created_at desc, m.id desc
  limit 1;

  if v_latest_user_message_id is distinct from v_repair.trigger_message_id then
    update public.station_operator_repairs
    set status='human_review', last_error='trigger_superseded', updated_at=now(), completed_at=now()
    where id=p_repair_id;

    insert into public.station_operator_audit(job_id,thread_id,action,outcome,details)
    values(v_repair.job_id,v_repair.thread_id,'repair_finalize','human_review',jsonb_build_object('repair_id',p_repair_id,'reason','trigger_superseded'));

    return jsonb_build_object('status','human_review','changed',true,'reason','trigger_superseded');
  end if;

  if nullif(btrim(coalesce(p_body,'')),'') is null then raise exception 'reply body required'; end if;

  insert into public.station_mail_messages(thread_id,sender_role,body)
  values(v_repair.thread_id,'admin',left(p_body,4000))
  returning id into v_message_id;

  update public.station_operator_repairs
  set status='completed', result=coalesce(result,'{}'::jsonb) || jsonb_build_object('reply_message_id',v_message_id), updated_at=now(), completed_at=now()
  where id=p_repair_id;

  insert into public.station_operator_audit(job_id,thread_id,action,outcome,details)
  values(v_repair.job_id,v_repair.thread_id,'repair_finalize','completed',jsonb_build_object('repair_id',p_repair_id,'reply_message_id',v_message_id));

  return jsonb_build_object('status','completed','changed',true,'replyMessageId',v_message_id);
end;
$$;

revoke execute on function public.station_operator_finalize_verified_repair(uuid,text) from public, anon, authenticated;
grant execute on function public.station_operator_finalize_verified_repair(uuid,text) to service_role;

commit;