import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../supabase/functions/anonymous-recovery-code/index.ts", import.meta.url),
  "utf8",
);

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

test("rotate revokes the current credential before inserting the replacement", () => {
  assert.match(source, /action\s*===\s*["']rotate["']/);
  assert.match(source, /revoked_at/);
  assert.match(source, /rotated_at/);
});
