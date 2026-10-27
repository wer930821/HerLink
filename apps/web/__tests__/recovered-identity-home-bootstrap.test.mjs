import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const homePath = path.resolve(process.cwd(), "apps/web/app/page.tsx");
const source = fs.readFileSync(homePath, "utf8");

test("recovered identity retries active session after effective profile resolution", () => {
  assert.match(source, /profileResult\.data\?\.id\s*!==\s*session\.user\.id/);
  assert.match(source, /recoveredIdentity/);
  assert.match(source, /await\s+loadMyActiveRandomSession\(\)/);
  assert.match(source, /resolvedSessionResult/);
});

test("home bootstrap recovery reconciliation does not mutate recovery or historical ownership", () => {
  const bootstrapStart = source.indexOf("async function bootstrap()");
  const bootstrapEnd = source.indexOf("return () =>", bootstrapStart);
  const bootstrap = source.slice(bootstrapStart, bootstrapEnd > bootstrapStart ? bootstrapEnd : undefined);

  assert.doesNotMatch(bootstrap, /approveAdminRecoveryRequest|claimPermanentRecovery|adminRestoreRandomSession|approve_random_session_recovery/);
  assert.doesNotMatch(bootstrap, /leaveRandomSession\(/);
});
