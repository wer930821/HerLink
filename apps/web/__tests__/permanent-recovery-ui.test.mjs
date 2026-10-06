import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync(new URL("../components/recovery-entry-options.tsx", import.meta.url), "utf8");
const flow = readFileSync(new URL("../components/permanent-recovery-flow.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/permanent-recovery.ts", import.meta.url), "utf8");

test("recovery entry offers permanent code self-service and preserves admin fallback", () => {
  assert.match(entry, /我有恢復碼/);
  assert.match(entry, /onUseRecoveryCode/);
  assert.match(entry, /onUseAdminRecovery/);
});

test("self-service recovery previews identity before claim", () => {
  assert.match(flow, /previewPermanentRecovery/);
  assert.match(flow, /找到匿名身分/);
  assert.match(flow, /確認接回/);
  assert.match(flow, /舊裝置會立即失效/);
});

test("successful claim shows the newly rotated permanent recovery code", () => {
  assert.match(flow, /claimPermanentRecovery/);
  assert.match(flow, /newRecoveryCode/);
  assert.match(flow, /新的永久恢復碼/);
  assert.match(flow, /舊恢復碼已失效/);
});

test("recovery client calls the edge endpoint with bearer auth and normalized eight-character code", () => {
  assert.match(api, /anonymous-recovery-claim/);
  assert.match(api, /Authorization/);
  assert.match(api, /Bearer/);
  assert.match(api, /replace\(\/\[\\s-\]\+\/g/);
  assert.match(api, /slice\(0,\s*8\)/);
  assert.match(api, /callRecovery<PermanentRecoveryPreview>\("preview", code\)/);
  assert.match(api, /callRecovery<PermanentRecoveryClaim>\("claim", code\)/);
  assert.match(api, /JSON\.stringify\(\{ action, recoveryCode: normalizedCode \}\)/);
});
