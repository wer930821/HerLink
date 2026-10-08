import assert from "node:assert/strict";
import test from "node:test";

import { validateRepairProposal } from "./policy.ts";

const allowed = {
  operation: "replace_file",
  branch: "ai-repair/job-123",
  path: "apps/web/lib/example.ts",
  content: "export const fixed = true;\n",
};

test("allows an application source edit on an isolated repair branch", () => {
  assert.deepEqual(validateRepairProposal(allowed), { ok: true });
});

test("rejects direct writes to main", () => {
  assert.equal(validateRepairProposal({ ...allowed, branch: "main" }).ok, false);
});

test("rejects Supabase migrations and SQL", () => {
  for (const path of ["supabase/migrations/20261009_fix.sql", "scripts/fix.sql"]) {
    assert.equal(validateRepairProposal({ ...allowed, path }).ok, false);
  }
});

test("rejects workflow and secret/environment paths", () => {
  for (const path of [".github/workflows/deploy.yml", ".env", ".env.production", "apps/web/.env.local", "secrets/token.txt"]) {
    assert.equal(validateRepairProposal({ ...allowed, path }).ok, false);
  }
});

test("rejects delete and arbitrary command operations", () => {
  assert.equal(validateRepairProposal({ ...allowed, operation: "delete_file" }).ok, false);
  assert.equal(validateRepairProposal({ ...allowed, operation: "run_command", command: "rm -rf /" }).ok, false);
});

test("rejects traversal and encoded paths that resolve outside the allowlist", () => {
  for (const path of ["apps/web/../../supabase/migrations/x.sql", "apps/web/%2e%2e/%2e%2e/.env", "%2e%2e/.env"]) {
    assert.equal(validateRepairProposal({ ...allowed, path }).ok, false);
  }
});

test("rejects non repair branches and non application/test paths", () => {
  assert.equal(validateRepairProposal({ ...allowed, branch: "feat/something" }).ok, false);
  assert.equal(validateRepairProposal({ ...allowed, path: "vercel.json" }).ok, false);
});