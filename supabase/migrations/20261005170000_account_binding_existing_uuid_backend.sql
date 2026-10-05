-- Test-branch contract for the controlled existing-account merge backend.
-- The live data-moving implementation is intentionally not applied by this file.
-- Production execution remains server-only and must use service_role.

-- Required test identity: 孤星企鵝
-- source UUID: e2817803-1304-4ef0-b0b8-66f473b12886
-- p_dry_run is required before any live merge.
-- Conflict gates: duplicate_session, duplicate_contact.
-- Any live conflict must RAISE EXCEPTION so PostgreSQL rolls the transaction back.
-- Audit fields: source_display_name, target_display_name.
-- Name-transfer invariant for the final RPC: anonymous_display_name = v_source_name.

-- Security contract for the final function:
-- REVOKE ALL ON FUNCTION public.admin_merge_anonymous_account(uuid, uuid, boolean) FROM PUBLIC;
-- REVOKE ALL ON FUNCTION public.admin_merge_anonymous_account(uuid, uuid, boolean) FROM anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.admin_merge_anonymous_account(uuid, uuid, boolean) TO service_role;

-- No require_active_admin() call is permitted here. Authorization is performed by
-- the allowlisted server route, and the database RPC remains inaccessible to clients.
