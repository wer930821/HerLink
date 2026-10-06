import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261006160000_anonymous_recovery_credentials.sql", import.meta.url),
  "utf8",
);

test("permanent recovery credential schema stores only a hash and lifecycle metadata", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.anonymous_recovery_credentials/i);
  assert.match(migration, /anonymous_identity_id UUID NOT NULL REFERENCES public\.profiles\(id\)/i);
  assert.match(migration, /code_hash TEXT NOT NULL/i);
  assert.match(migration, /code_hint TEXT NOT NULL/i);
  assert.match(migration, /version INTEGER NOT NULL DEFAULT 1/i);
  assert.match(migration, /created_at TIMESTAMPTZ NOT NULL/i);
  assert.match(migration, /rotated_at TIMESTAMPTZ/i);
  assert.match(migration, /used_at TIMESTAMPTZ/i);
  assert.match(migration, /revoked_at TIMESTAMPTZ/i);
  assert.match(migration, /last_used_at TIMESTAMPTZ/i);
  assert.doesNotMatch(migration, /\brecovery_code\s+TEXT\b/i);
});

test("only one active permanent recovery credential may exist per anonymous identity", () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS anonymous_recovery_credentials_one_active_per_identity[\s\S]*anonymous_identity_id[\s\S]*WHERE used_at IS NULL AND revoked_at IS NULL/i,
  );
});

test("clients cannot directly read or write recovery credential hashes", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON public\.anonymous_recovery_credentials FROM public, anon, authenticated/i);
  assert.match(migration, /GRANT ALL ON public\.anonymous_recovery_credentials TO service_role/i);
});
