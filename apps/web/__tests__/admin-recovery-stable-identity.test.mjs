import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const oldMigration = fs.readFileSync('supabase/migrations/20261009003000_admin_recovery_stable_identity.sql', 'utf8');
const client = fs.readFileSync('apps/web/lib/supabase.ts', 'utf8');

test('admin recovery must preserve original anonymous identity instead of migrating chat data', () => {
  assert.match(oldMigration, /anonymous_identity_device_state/);
  assert.match(oldMigration, /anonymous_identity_id\s*,\s*active_auth_user_id/);
  assert.doesNotMatch(oldMigration, /set anonymous_display_name=v_archive where id=v_source/);
  assert.doesNotMatch(oldMigration, /set sender_id=p_target_user_id/);
  assert.doesNotMatch(oldMigration, /where status='active' and \(user_a=v_source or user_b=v_source\)/);
});

test('admin client keeps legacy recovery code action available', () => {
  assert.match(client, /approveAdminRecoveryRequest\(code:string, side:"a"\|"b"\)/);
  assert.match(client, /approve_random_session_recovery/);
});
