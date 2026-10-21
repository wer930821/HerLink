import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = "supabase/migrations/20261021220000_allow_ended_session_admin_recovery.sql";
const source = fs.readFileSync(migration, "utf8");

test("pending admin recovery can resolve the selected identity from an ended session", () => {
  assert.match(source, /from public\.random_chat_sessions\s+where id=v_req\.session_id\s+for update/i);
  assert.doesNotMatch(source, /where id=v_req\.session_id and status='active'/i);
});

test("ended-session recovery still requires a valid anonymous identity", () => {
  assert.match(source, /public\.profiles/i);
  assert.match(source, /anonymous_mode_enabled=true/i);
});

test("ended-session recovery only rebinds device state and preserves history", () => {
  assert.match(source, /anonymous_identity_device_state/i);
  assert.doesNotMatch(source, /update public\.random_chat_sessions/i);
  assert.doesNotMatch(source, /update public\.random_chat_messages/i);
  assert.doesNotMatch(source, /update public\.anonymous_contacts/i);
});

test("successful recovery resolves the pending request", () => {
  assert.match(source, /set status='approved',resolved_at=now\(\)/i);
});
