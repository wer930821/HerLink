import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261006170000_anonymous_identity_device_generation.sql", import.meta.url), "utf8");

test("identity ownership is represented separately from immutable chat participant ids", () => {
  assert.match(migration, /anonymous_identity_device_state/);
  assert.match(migration, /anonymous_identity_id UUID NOT NULL(?: PRIMARY KEY)? REFERENCES public\.profiles\(id\)/);
  assert.match(migration, /active_auth_user_id UUID NOT NULL/);
  assert.match(migration, /generation BIGINT NOT NULL/);
});

test("takeover atomically changes the active device owner and increments generation", () => {
  assert.match(migration, /claim_anonymous_identity_device/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /generation\s*=\s*generation\s*\+\s*1/i);
  assert.match(migration, /active_auth_user_id\s*=\s*p_new_auth_user_id/i);
});

test("authorization helper rejects stale devices", () => {
  assert.match(migration, /is_active_anonymous_identity_device/);
  assert.match(migration, /active_auth_user_id\s*=\s*p_auth_user_id/i);
  assert.match(migration, /generation\s*=\s*p_generation/i);
});

test("device state is server-only", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.anonymous_identity_device_state FROM public, anon, authenticated/i);
  assert.match(migration, /GRANT ALL ON public\.anonymous_identity_device_state TO service_role/i);
});
