import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const claim = readFileSync(
  new URL("../../../supabase/functions/anonymous-recovery-claim/index.ts", import.meta.url),
  "utf8",
);

test("recovery claim validates the effective stable anonymous identity", () => {
  assert.match(claim, /resolve_active_anonymous_chat_identity/);
  assert.match(claim, /currentIdentityId/);
  assert.match(claim, /\.eq\("id",currentIdentityId\)/);
});

test("recovery takeover still assigns the current auth user as the replacement principal", () => {
  assert.match(claim, /p_new_auth_user_id:user\.id/);
  assert.doesNotMatch(claim, /p_new_auth_user_id:currentIdentityId/);
});

test("recovery claim keeps rate limiting and credential rotation", () => {
  assert.match(claim, /check_anonymous_recovery_rate_limit/);
  assert.match(claim, /generateRecoveryCode\(\)/);
  assert.match(claim, /claim_anonymous_recovery_and_device/);
  assert.match(claim, /p_new_code_hash:newHash/);
});
