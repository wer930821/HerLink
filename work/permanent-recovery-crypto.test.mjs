import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(
  new URL("../supabase/functions/_shared/anonymous-recovery.ts", import.meta.url),
  "utf8",
);

test("recovery code uses cryptographic randomness and an 8-character safe alphabet", () => {
  assert.match(helper, /crypto\.getRandomValues/);
  assert.match(helper, /RECOVERY_CODE_LENGTH\s*=\s*8/);
  assert.match(helper, /RECOVERY_CODE_ALPHABET\s*=\s*["'][A-Z0-9]+["']/);
  assert.match(helper, /generateRecoveryCode/);
});

test("recovery code is normalized before hashing and the server secret is required", () => {
  assert.match(helper, /normalizeRecoveryCode/);
  assert.match(helper, /RECOVERY_CODE_HMAC_SECRET/);
  assert.match(helper, /crypto\.subtle\.sign/);
  assert.match(helper, /HMAC/);
  assert.match(helper, /SHA-256/);
});

test("hint reveals only the last two recovery-code characters", () => {
  assert.match(helper, /recoveryCodeHint/);
  assert.match(helper, /••••••/);
  assert.match(helper, /slice\(-2\)/);
});

test("verification uses a constant-time byte comparison", () => {
  assert.match(helper, /constantTimeEqual/);
  assert.match(helper, /diff\s*\|=/);
  assert.match(helper, /verifyRecoveryCodeHash/);
});

test("recovery brute-force policy is explicit and suitable for an 8-character permanent code", () => {
  assert.match(helper, /RECOVERY_ATTEMPT_LIMIT\s*=\s*5/);
  assert.match(helper, /RECOVERY_ATTEMPT_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(helper, /RECOVERY_LOCKOUT_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(helper, /isRecoveryAttemptRateLimited/);
});
