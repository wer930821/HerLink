import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const homePath = path.resolve(process.cwd(), "apps/web/app/page.tsx");
const source = fs.readFileSync(homePath, "utf8");
const start = source.indexOf("const requestRecovery = async () =>");
const end = source.indexOf("\n  };", start);
const requestRecovery = source.slice(start, end > start ? end : undefined);

test("recovery entry checks the current session before creating an anonymous session", () => {
  assert.match(requestRecovery, /getCurrentSession\(\)/);
  assert.match(requestRecovery, /if\s*\(!current\.data\.session\)/);
  assert.match(requestRecovery, /signInAnonymously\(\)/);
  assert.match(requestRecovery, /await\s+waitForCurrentSession\(\)/);
  assert.match(requestRecovery, /session unavailable/i);
});

test("recovery entry exposes the actual recovery RPC error", () => {
  assert.match(requestRecovery, /catch\s*\(error\)/);
  assert.match(requestRecovery, /getFriendlyAuthErrorMessage\(error/);
});
