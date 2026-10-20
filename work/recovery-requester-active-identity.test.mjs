import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = "supabase/migrations/20261020225500_fix_recovery_requester_active_identity.sql";

test("manual recovery stores the resolved active anonymous identity instead of raw auth uid", () => {
  assert.ok(fs.existsSync(migration), "missing recovery requester identity migration");
  const source = fs.readFileSync(migration, "utf8");
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.request_random_session_recovery/i);
  assert.match(source, /public\.resolve_active_anonymous_chat_identity\(\)/i);
  assert.match(source, /requester_user_id[^\n]*v_actor/i);
});

test("admin approval repairs legacy pending requests whose requester is an auth uid mapped to an anonymous identity", () => {
  assert.ok(fs.existsSync(migration), "missing recovery requester identity migration");
  const source = fs.readFileSync(migration, "utf8");
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.approve_random_session_recovery/i);
  assert.match(source, /anonymous_identity_device_state/i);
  assert.match(source, /active_auth_user_id\s*=\s*v_req\.requester_user_id/i);
});
