import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(new URL("../components/ui/Modal.tsx", import.meta.url), "utf8");

test("recovery modal offers self-service code flow and preserves manual children", () => {
  assert.match(modalSource, /const isRecoveryDialog = title === "找回原本聊天室"/);
  assert.match(modalSource, /PermanentRecoveryFlow/);
  assert.match(modalSource, /onUseRecoveryCode=\{\(\) => setRecoveryBranch\("code"\)\}/);
  assert.match(modalSource, /onUseAdminRecovery=\{\(\) => setRecoveryBranch\("admin"\)\}/);
  assert.match(modalSource, /recoveryBranch === "admin" \? children : null/);
});

test("closing the modal resets the recovery branch", () => {
  assert.match(modalSource, /if \(!open\) \{\s*setRecoveryBranch\("entry"\);/);
});
