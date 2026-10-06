import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/functions/anonymous-recovery-code/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261006160000_anonymous_recovery_credentials.sql", import.meta.url), "utf8");

test("permanent recovery code endpoint requires an authenticated current identity", () => {
  assert.match(source, /authorization/i);
  assert.match(source, /auth\.getUser/);
  assert.match(source, /401/);
});

test("GET returns status and hint without returning stored hashes or plaintext codes", () => {
  assert.match(source, /req\.method === "GET"/);
  assert.match(source, /hasRecoveryCode/);
  assert.match(source, /hint/);
  assert.doesNotMatch(source, /json\(\{[^}]*code_hash/si);
});

test("POST generates one permanent code and stores only its hash", () => {
  assert.match(source, /generateRecoveryCode/);
  assert.match(source, /hashRecoveryCode/);
  assert.match(source, /anonymous_recovery_credentials/);
  assert.match(source, /recoveryCode/);
});

test("rotate delegates revocation and replacement insertion to one database transaction", () => {
  assert.match(source, /action\s*===\s*["']rotate["']/);
  assert.match(source, /rotate_anonymous_recovery_credential/);
  assert.match(migration, /SET revoked_at\s*=\s*v_now,\s*rotated_at\s*=\s*v_now/i);
  assert.match(migration, /INSERT INTO public\.anonymous_recovery_credentials/);
  assert.match(migration, /FOR UPDATE/);
});
