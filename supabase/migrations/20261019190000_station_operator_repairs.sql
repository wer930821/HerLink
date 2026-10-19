begin;

create table if not exists public.station_operator_repairs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.station_operator_jobs(id) on delete cascade,
  thread_id uuid not null references public.station_mail_threads(id) on delete cascade,
  trigger_message_id uuid references public.station_mail_messages(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','dispatched','waiting_ci','waiting_deploy','verifying','completed','human_review','failed')),
  risk text not null default 'low' check (risk in ('low','high')),
  summary text not null default '',
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  branch_name text,
  pr_number integer,
  commit_sha text,
  ci_run_id bigint,
  deployment_id text,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists station_operator_repairs_job_unique on public.station_operator_repairs(job_id);
create unique index if not exists station_operator_repairs_trigger_unique on public.station_operator_repairs(trigger_message_id) where trigger_message_id is not null;
create index if not exists station_operator_repairs_status_idx on public.station_operator_repairs(status, created_at);

alter table public.station_operator_repairs enable row level security;
revoke all on public.station_operator_repairs from public, anon, authenticated;
grant all on public.station_operator_repairs to service_role;

create or replace function public.station_operator_create_repair(
  p_job_id uuid,
  p_claim_token uuid,
  p_risk text,
  p_summary text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.station_operator_jobs%rowtype;
  v_id uuid;
begin
  if p_risk not in ('low','high') then raise exception 'invalid risk'; end if;
  select * into v_job from public.station_operator_jobs
    where id=p_job_id and status='processing' and claim_token=p_claim_token
    for update;
  if not found then raise exception 'job not claimable'; end if;

  insert into public.station_operator_repairs(job_id,thread_id,trigger_message_id,status,risk,summary)
  values(v_job.id,v_job.thread_id,v_job.trigger_message_id,case when p_risk='high' then 'human_review' else 'queued' end,p_risk,left(coalesce(p_summary,''),800))
  on conflict (job_id) do update set updated_at=now()
  returning id into v_id;

  insert into public.station_operator_audit(job_id,thread_id,action,outcome,details)
  values(v_job.id,v_job.thread_id,'repair_created',case when p_risk='high' then 'human_review' else 'queued' end,jsonb_build_object('repair_id',v_id,'risk',p_risk));
  return v_id;
end;
$$;

revoke execute on function public.station_operator_create_repair(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.station_operator_create_repair(uuid,uuid,text,text) to service_role;

commit;
