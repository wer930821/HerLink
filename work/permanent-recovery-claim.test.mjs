import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/functions/anonymous-recovery-claim/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261006160000_anonymous_recovery_credentials.sql", import.meta.url), "utf8");

test("preview accepts only a recovery code and reveals only the anonymous display name", () => {
  assert.match(source, /action\s*===\s*["']preview["']/);
  assert.match(source, /anonymous_display_name/);
  assert.match(source, /displayName/);
  assert.doesNotMatch(source, /partner_anonymous_display_name/);
});

test("claim requires a currently authenticated replacement anonymous identity", () => {
  assert.match(source, /auth\.getUser/);
  assert.match(source, /anonymous_mode_enabled/);
  assert.match(source, /claim/);
});

test("claim is delegated to a security-definer transaction that locks the credential", () => {
  assert.match(source, /claim_anonymous_recovery_credential/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_anonymous_recovery_credential/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /used_at\s*=\s*v_now/);
});

test("successful claim rotates to a new permanent code in the same transaction", () => {
  assert.match(migration, /p_new_code_hash/);
  assert.match(migration, /p_new_code_hint/);
  assert.match(migration, /INSERT INTO public\.anonymous_recovery_credentials/);
  assert.match(source, /newRecoveryCode/);
});
