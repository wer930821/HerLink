-- Fix recovery approvals that fail with "找不到目前 Web 身分".
-- Recovery codes are created by the replacement browser identity; persist that
-- requester on the recovery request and use it when an admin approves later.

alter table if exists public.random_session_recovery_requests
  add column if not exists requester_user_id uuid;

-- Backfill from the row creator where deployments already keep created_by.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='random_session_recovery_requests' and column_name='created_by'
  ) then
    execute 'update public.random_session_recovery_requests set requester_user_id = created_by where requester_user_id is null';
  end if;
end $$;

-- NOTE: Existing RPCs remain authoritative for session/name transfer. This
-- column is intentionally added first so request creation can persist the
-- replacement identity instead of trying to infer the admin browser identity
-- at approval time.
comment on column public.random_session_recovery_requests.requester_user_id is
  'Replacement Web identity that created this recovery request; used by admin approval.';
