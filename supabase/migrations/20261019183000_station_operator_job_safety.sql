begin;

-- Recover abandoned claims after a 10 minute lease. Jobs that already used
-- both attempts become terminal instead of being retried forever.
create or replace function public.station_operator_claim(p_limit integer default 5)
returns setof public.station_operator_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.station_operator_jobs
  set status = case when attempt_count >= 2 then 'failed' else 'pending' end,
      claim_token = null,
      claimed_at = null,
      last_error = case when attempt_count >= 2 then 'processing lease expired' else last_error end,
      updated_at = now()
  where status = 'processing'
    and claimed_at < now() - interval '10 minutes';

  return query
  with picked as (
    select j.id
    from public.station_operator_jobs j
    where j.status = 'pending'
      and j.attempt_count < 2
    order by j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 10))
  )
  update public.station_operator_jobs j
  set status = 'processing',
      attempt_count = j.attempt_count + 1,
      claim_token = gen_random_uuid(),
      claimed_at = now(),
      updated_at = now()
  from picked p
  where j.id = p.id
  returning j.*;
end;
$$;

revoke execute on function public.station_operator_claim(integer) from public, anon, authenticated;
grant execute on function public.station_operator_claim(integer) to service_role;

commit;
