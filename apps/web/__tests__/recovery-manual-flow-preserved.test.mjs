import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("manual recovery still creates the existing recovery request", () => {
  assert.match(pageSource, /requestRandomIdentityRecovery\(recoveryName\)/);
  assert.match(pageSource, /取得恢復碼/);
  assert.match(pageSource, /請把這組 8 碼傳給管理員/);
});
