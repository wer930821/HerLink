import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");

test("profile and queue reads resolve the active stable anonymous identity", () => {
  assert.match(source, /resolveActiveAnonymousChatIdentity/);
  assert.match(source, /loadMyProfile[\s\S]*resolveActiveAnonymousChatIdentity/);
  assert.match(source, /loadMyRandomQueue[\s\S]*resolveActiveAnonymousChatIdentity/);
});
