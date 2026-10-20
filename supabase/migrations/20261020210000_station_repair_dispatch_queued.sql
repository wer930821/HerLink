-- Controlled dispatcher for an already-created queued repair. This only
-- returns the bounded repair record; the Repair Engine performs the attempt
-- gate, context discovery, model planning, validation, and GitHub write.
create or replace function public.station_operator_dispatch_queued_repair(p_repair_id uuid)
returns table(id uuid, job_id uuid, risk text, status text, attempt_count integer, summary text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select r.id, r.job_id, r.risk, r.status, r.attempt_count, r.summary
  from public.station_operator_repairs r
  where r.id = p_repair_id
    and r.status = 'queued'
    and r.risk = 'low'
    and r.attempt_count < 2;
end;
$$;

revoke execute on function public.station_operator_dispatch_queued_repair(uuid) from public, anon, authenticated;
grant execute on function public.station_operator_dispatch_queued_repair(uuid) to service_role;
