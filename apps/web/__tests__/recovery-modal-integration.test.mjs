import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(new URL("../components/ui/Modal.tsx", import.meta.url), "utf8");

test("recovery modal keeps manual children hidden until admin path is selected", () => {
  assert.match(modalSource, /const isRecoveryDialog = title === "找回原本聊天室"/);
  assert.match(modalSource, /<RecoveryEntryOptions onUseAdminRecovery=\{\(\) => setShowRecoveryAdmin\(true\)\} \/>/);
  assert.match(modalSource, /showRecoveryAdmin \? children : null/);
});

test("closing the modal resets the manual recovery branch", () => {
  assert.match(modalSource, /if \(!open\) \{\s*setShowRecoveryAdmin\(false\);/);
});
