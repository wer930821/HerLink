begin;

create table if not exists public.station_operator_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.station_mail_threads(id) on delete cascade,
  trigger_message_id uuid references public.station_mail_messages(id) on delete set null,
  kind text not null default 'triage' check (kind in ('triage','reply','bug_repair','human_review')),
  status text not null default 'pending' check (status in ('pending','processing','waiting_ci','completed','failed','human_review')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  claim_token uuid,
  claimed_at timestamptz,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists station_operator_jobs_trigger_unique
  on public.station_operator_jobs(trigger_message_id, kind)
  where trigger_message_id is not null;
create index if not exists station_operator_jobs_pending_idx
  on public.station_operator_jobs(status, created_at);

create table if not exists public.station_operator_audit (
  id bigint generated always as identity primary key,
  job_id uuid references public.station_operator_jobs(id) on delete set null,
  thread_id uuid references public.station_mail_threads(id) on delete set null,
  action text not null,
  outcome text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists station_operator_audit_thread_idx
  on public.station_operator_audit(thread_id, created_at desc);

alter table public.station_operator_jobs enable row level security;
alter table public.station_operator_audit enable row level security;
revoke all on public.station_operator_jobs from anon, authenticated;
revoke all on public.station_operator_audit from anon, authenticated;
grant all on public.station_operator_jobs to service_role;
grant all on public.station_operator_audit to service_role;
grant usage, select on sequence public.station_operator_audit_id_seq to service_role;

create or replace function public.station_operator_enqueue_unread(p_limit integer default 20)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with latest_user_message as (
    select distinct on (m.thread_id) m.thread_id, m.id as message_id, m.created_at
    from public.station_mail_messages m
    join public.station_mail_threads t on t.id = m.thread_id
    where t.deleted_at is null and m.sender_role = 'user'
    order by m.thread_id, m.created_at desc
  ), ins as (
    insert into public.station_operator_jobs(thread_id, trigger_message_id, kind)
    select l.thread_id, l.message_id, 'triage' from latest_user_message l
    where not exists (select 1 from public.station_operator_jobs j where j.trigger_message_id=l.message_id and j.kind='triage')
    order by l.created_at asc limit greatest(1, least(coalesce(p_limit,20),50))
    on conflict do nothing returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end; $$;

create or replace function public.station_operator_claim(p_limit integer default 5)
returns setof public.station_operator_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query with picked as (
    select j.id from public.station_operator_jobs j
    where j.status='pending' and j.attempt_count<2
    order by j.created_at asc for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),10))
  ) update public.station_operator_jobs j
    set status='processing',attempt_count=j.attempt_count+1,claim_token=gen_random_uuid(),claimed_at=now(),updated_at=now()
    from picked p where j.id=p.id returning j.*;
end; $$;

create or replace function public.station_operator_finish(p_job_id uuid,p_claim_token uuid,p_status text,p_result jsonb default '{}'::jsonb,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('pending','waiting_ci','completed','failed','human_review') then raise exception 'invalid status'; end if;
  update public.station_operator_jobs set status=p_status,result=coalesce(p_result,'{}'::jsonb),last_error=p_error,claim_token=null,claimed_at=null,updated_at=now()
  where id=p_job_id and status='processing' and claim_token=p_claim_token;
  return found;
end; $$;

revoke execute on function public.station_operator_enqueue_unread(integer) from public, anon, authenticated;
revoke execute on function public.station_operator_claim(integer) from public, anon, authenticated;
revoke execute on function public.station_operator_finish(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.station_operator_enqueue_unread(integer) to service_role;
grant execute on function public.station_operator_claim(integer) to service_role;
grant execute on function public.station_operator_finish(uuid,uuid,text,jsonb,text) to service_role;

commit;
