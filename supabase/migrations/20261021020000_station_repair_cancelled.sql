begin;
create or replace function public.station_operator_apply_repair_event(p_repair_id uuid,p_event text,p_metadata jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_repair public.station_operator_repairs%rowtype; v_next text; v_changed boolean := true; v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
begin
if p_event not in ('ci_success','ci_failure','deploy_success','deploy_failure','engine_blocked','cancelled') then raise exception 'invalid repair event'; end if;
select * into v_repair from public.station_operator_repairs where id=p_repair_id for update;
if not found then raise exception 'repair not found'; end if;
v_next := case
 when v_repair.status='waiting_ci' and p_event='ci_success' then 'waiting_deploy'
 when v_repair.status='waiting_ci' and p_event='ci_failure' then 'human_review'
 when v_repair.status='waiting_deploy' and p_event='deploy_success' then 'verifying'
 when v_repair.status='waiting_deploy' and p_event='deploy_failure' then 'human_review'
 when v_repair.status in ('queued','dispatched','running') and p_event='engine_blocked' then 'human_review'
 when v_repair.status='queued' and p_event='cancelled' then 'cancelled'
 else null end;
if v_next is null then
 if (v_repair.status='waiting_deploy' and p_event='ci_success') or (v_repair.status='verifying' and p_event='deploy_success') or (v_repair.status='human_review' and p_event in ('ci_failure','deploy_failure','engine_blocked')) or (v_repair.status='cancelled' and p_event='cancelled') then
  v_changed:=false; v_next:=v_repair.status;
 else raise exception 'invalid repair transition'; end if;
end if;
if v_changed then
 update public.station_operator_repairs set status=v_next,updated_at=now(),completed_at=case when v_next in ('human_review','completed','failed','cancelled') then now() else completed_at end where id=p_repair_id;
 insert into public.station_operator_audit(job_id,thread_id,action,outcome,details) values(v_repair.job_id,v_repair.thread_id,'repair_callback',v_next,jsonb_build_object('repair_id',p_repair_id,'event',p_event,'metadata',v_meta));
end if;
return jsonb_build_object('status',v_next,'changed',v_changed);
end; $$;
revoke execute on function public.station_operator_apply_repair_event(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.station_operator_apply_repair_event(uuid,text,jsonb) to service_role;
commit;