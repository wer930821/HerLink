import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const copySource = readFileSync(new URL("../lib/recovery-copy.ts", import.meta.url), "utf8");
const componentSource = readFileSync(new URL("../components/recovery-entry-options.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("recovery copy explains that forgetting the anonymous name is okay", () => {
  assert.match(copySource, /忘記匿名名稱也沒關係/);
});

test("recovery copy exposes recovery-code and admin-help paths", () => {
  assert.match(copySource, /我有恢復碼/);
  assert.match(copySource, /我沒有恢復碼／需要站長協助/);
});

test("recovery entry does not pretend unfinished self-service recovery is active", () => {
  assert.match(componentSource, /永久自助恢復功能正在完成中/);
  assert.match(componentSource, /避免半成品造成身分誤接/);
});

test("existing recovery modal renders the recovery entry options before admin recovery", () => {
  assert.match(pageSource, /import \{ RecoveryEntryOptions \} from "\.\.\/components\/recovery-entry-options"/);
  assert.match(pageSource, /<RecoveryEntryOptions onUseAdminRecovery=\{\(\) => setRecoveryAdminOpen\(true\)\} \/>/);
  assert.match(pageSource, /recoveryAdminOpen \? \(/);
});

test("existing manual recovery request remains available", () => {
  assert.match(pageSource, /requestRandomIdentityRecovery\(recoveryName\)/);
  assert.match(pageSource, /取得恢復碼/);
  assert.match(pageSource, /請把這組 8 碼傳給管理員/);
});
