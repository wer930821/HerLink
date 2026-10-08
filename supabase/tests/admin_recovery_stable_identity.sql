-- Regression test: admin session recovery must persist a stable anonymous identity binding.
-- This test is intentionally RED against the current production migration.
-- The restore function must reference anonymous_identity_device_state and bind
-- the restored identity to the target auth user so a refresh can resolve it.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_restore_random_session_to_user'
  limit 1;

  if v_def is null then
    raise exception 'admin_restore_random_session_to_user is missing';
  end if;

  if position('anonymous_identity_device_state' in v_def) = 0 then
    raise exception 'RED: admin restore does not persist anonymous_identity_device_state';
  end if;

  if position('active_auth_user_id' in v_def) = 0 then
    raise exception 'RED: admin restore does not bind active_auth_user_id';
  end if;
end
$$;
