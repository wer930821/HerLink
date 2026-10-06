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

test("self-service recovery creates or reuses an anonymous replacement principal before preview", () => {
  assert.match(flow, /signInAnonymously/);
  assert.match(flow, /ensureAnonymousBootstrapProfile/);
  assert.match(flow, /const authUser = data\.user \?\? data\.session\?\.user/);
  assert.match(flow, /const userId = authUser\?\.id/);
  assert.match(flow, /await\s+ensureAnonymousBootstrapProfile/);
});

test("replacement principal must be an anonymous auth user before profile bootstrap", () => {
  assert.match(flow, /is_anonymous/);
  const anonymousGuard = flow.indexOf("is_anonymous");
  const bootstrap = flow.indexOf("ensureAnonymousBootstrapProfile(userId)");
  assert.ok(anonymousGuard !== -1 && bootstrap !== -1 && anonymousGuard < bootstrap);
});

test("self-service recovery previews identity before claim", () => {
  assert.match(flow, /previewPermanentRecovery/);
  assert.match(flow, /找到匿名身分/);
  assert.match(flow, /確認接回/);
  assert.match(flow, /舊裝置會立即失效/);
});

test("successful claim shows the newly rotated permanent recovery code before recovery callback", () => {
  assert.match(flow, /claimPermanentRecovery/);
  assert.match(flow, /newRecoveryCode/);
  assert.match(flow, /新的永久恢復碼/);
  assert.match(flow, /舊恢復碼已失效/);
  const claimStart = flow.indexOf("const claim = async");
  const finishStart = flow.indexOf("const finishRecovery");
  const successScreen = flow.indexOf("if (newRecoveryCode)");
  assert.ok(claimStart !== -1 && finishStart > claimStart && successScreen > finishStart);
  assert.doesNotMatch(flow.slice(claimStart, finishStart), /onRecovered\?\.\(\)/);
  assert.match(flow.slice(finishStart, successScreen), /onRecovered\?\.\(\)/);
  assert.match(flow.slice(successScreen), /onClick=\{finishRecovery\}/);
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
