# Expected RED

The first focused test should fail against `20261009003000_admin_recovery_stable_identity.sql` because that migration archives the source display name, moves source active sessions/messages/contacts to `p_target_user_id`, and records the target as its own stable identity.