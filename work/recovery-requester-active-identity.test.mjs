import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = "supabase/migrations/20261020225500_fix_recovery_requester_active_identity.sql";
const source = fs.readFileSync(migration, "utf8");

test("admin recovery accepts a requester auth user even when it has no profile row", () => {
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.approve_random_session_recovery/i);
  assert.match(source, /select 1 from auth\.users where id=v_req\.requester_user_id/i);
  assert.doesNotMatch(source, /select 1 from public\.profiles where id=v_req\.requester_user_id/i);
});

test("admin recovery binds the selected old anonymous identity to requester auth uid", () => {
  assert.match(source, /anonymous_identity_device_state/i);
  assert.match(source, /anonymous_identity_id,active_auth_user_id/i);
  assert.match(source, /values\(v_old,v_req\.requester_user_id,1/i);
  assert.match(source, /set active_auth_user_id=v_req\.requester_user_id/i);
});

test("admin recovery does not rewrite historical session or message ownership", () => {
  assert.doesNotMatch(source, /update public\.random_chat_sessions/i);
  assert.doesNotMatch(source, /update public\.random_chat_messages/i);
  assert.doesNotMatch(source, /update public\.anonymous_contacts/i);
});
