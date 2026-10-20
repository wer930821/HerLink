import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261020_admin_recovery_preserve_original_identity.sql', 'utf8');
const client = fs.readFileSync('apps/web/lib/supabase.ts', 'utf8');

test('admin recovery must preserve original anonymous identity instead of migrating chat data', () => {
  assert.match(migration, /anonymous_identity_device_state/);
  assert.match(migration, /anonymous_identity_id\s*,\s*active_auth_user_id/);
  assert.match(migration, /values\s*\(\s*v_source\s*,\s*p_target_user_id/i);
  assert.match(migration, /where active_auth_user_id = p_target_user_id\s+and anonymous_identity_id <> v_source/i);
  assert.match(migration, /generation = generation \+ 1/i);
  assert.match(migration, /raise exception '恢復失敗：穩定身分已綁定其他裝置或發生唯一值衝突/);
  assert.doesNotMatch(migration, /set anonymous_display_name/i);
  assert.doesNotMatch(migration, /update public\.(random_chat_sessions|random_chat_messages|anonymous_contacts)/i);
  assert.doesNotMatch(migration, /update public\.random_session_icebreaker_events/i);
});

test('admin recovery rejects invalid sessions, sides, missing profiles, and the opposite participant', () => {
  assert.match(migration, /if p_side is null or p_side not in \('a','b'\)/);
  assert.match(migration, /if not found then\s+raise exception '恢復失敗：找不到聊天室。'/i);
  assert.match(migration, /if v_other = p_target_user_id then\s+raise exception '恢復失敗：目前 Web 身分已是聊天室另一方。'/i);
  assert.match(migration, /if not exists \(select 1 from public\.profiles where id = v_source\)/i);
  assert.match(migration, /if not exists \(select 1 from public\.profiles where id = p_target_user_id\)/i);
});

test('admin recovery can retry while keeping the selected session side as canonical identity', () => {
  assert.match(migration, /select \* into v_state[\s\S]*?where anonymous_identity_id = v_source[\s\S]*?for update/i);
  assert.match(migration, /update public\.anonymous_identity_device_state[\s\S]*?where anonymous_identity_id = v_source/i);
  assert.match(migration, /return v_s;/);
});

test('admin client keeps legacy recovery code action available', () => {
  assert.match(client, /approveAdminRecoveryRequest\(code:string, side:"a"\|"b"\)/);
  assert.match(client, /approve_random_session_recovery/);
});
