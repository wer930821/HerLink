import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const copySource = readFileSync(new URL("../lib/recovery-copy.ts", import.meta.url), "utf8");

test("recovery copy explains that forgetting the anonymous name is okay", () => {
  assert.match(copySource, /忘記匿名名稱也沒關係/);
});

test("recovery copy exposes recovery-code and admin-help paths", () => {
  assert.match(copySource, /我有恢復碼/);
  assert.match(copySource, /我沒有恢復碼／需要站長協助/);
});
