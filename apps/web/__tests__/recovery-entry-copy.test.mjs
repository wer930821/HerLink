import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const copySource = readFileSync(new URL("../lib/recovery-copy.ts", import.meta.url), "utf8");
const componentSource = readFileSync(new URL("../components/recovery-entry-options.tsx", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../components/ui/Modal.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("recovery copy explains that forgetting the anonymous name is okay", () => {
  assert.match(copySource, /忘記匿名名稱也沒關係/);
});

test("recovery copy exposes recovery-code and admin-help paths", () => {
  assert.match(copySource, /我有恢復碼/);
  assert.match(copySource, /我沒有恢復碼／需要站長協助/);
});

test("recovery entry activates self-service code recovery", () => {
  assert.match(componentSource, /onUseRecoveryCode/);
  assert.match(componentSource, />我有恢復碼</);
  assert.match(componentSource, /onUseAdminRecovery/);
});

test("existing recovery modal routes to self-service or manual recovery", () => {
  assert.match(modalSource, /import \{ RecoveryEntryOptions \} from "\.\.\/recovery-entry-options"/);
  assert.match(modalSource, /import \{ PermanentRecoveryFlow \} from "\.\.\/permanent-recovery-flow"/);
  assert.match(modalSource, /title === "找回原本聊天室"/);
  assert.match(modalSource, /onUseRecoveryCode=\{\(\) => setRecoveryBranch\("code"\)\}/);
  assert.match(modalSource, /onUseAdminRecovery=\{\(\) => setRecoveryBranch\("admin"\)\}/);
  assert.match(modalSource, /recoveryBranch === "admin" \? children : null/);
});

test("existing manual recovery request remains available", () => {
  assert.match(pageSource, /requestRandomIdentityRecovery\(recoveryName\)/);
  assert.match(pageSource, /取得恢復碼/);
  assert.match(pageSource, /請把這組 8 碼傳給管理員/);
});
