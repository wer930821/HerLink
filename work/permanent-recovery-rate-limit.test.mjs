import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20261006182000_anonymous_recovery_rate_limit.sql", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/anonymous-recovery-claim/index.ts", import.meta.url), "utf8");

test("recovery attempts are stored server-side without plaintext recovery codes", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.anonymous_recovery_attempts/i);
  assert.match(migration, /requester_id UUID NOT NULL/i);
  assert.match(migration, /code_hash TEXT NOT NULL/i);
  assert.match(migration, /attempted_at TIMESTAMPTZ NOT NULL/i);
  assert.doesNotMatch(migration, /recovery_code\s+TEXT/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.anonymous_recovery_attempts FROM PUBLIC, anon, authenticated/i);
});

test("durable limiter counts guesses per requester and persists a thirty minute lockout without rollback", () => {
  assert.match(migration, /check_anonymous_recovery_rate_limit/i);
  assert.match(migration, /INTERVAL '15 minutes'/i);
  assert.match(migration, />=\s*4/i);
  assert.match(migration, /INTERVAL '30 minutes'/i);
  assert.match(migration, /RETURNS TABLE\s*\(allowed BOOLEAN, locked_until TIMESTAMPTZ\)/i);
  assert.match(migration, /WHERE a\.requester_id\s*=\s*p_requester_id/i);
  assert.doesNotMatch(migration, /AND a\.code_hash\s*=\s*p_code_hash\s*\n\s*AND a\.attempted_at/i);
  assert.doesNotMatch(migration, /RAISE EXCEPTION 'RECOVERY_RATE_LIMITED'/i);
  assert.match(migration, /DELETE FROM public\.anonymous_recovery_attempts[\s\S]*INTERVAL '24 hours'/i);
});

test("preview and claim both call the durable limiter before credential lookup or claim", () => {
  assert.match(edge, /check_anonymous_recovery_rate_limit/);
  assert.match(edge, /allowed/);
  assert.match(edge, /429/);
  const limiter = edge.indexOf('check_anonymous_recovery_rate_limit');
  const credentialLookup = edge.indexOf('anonymous_recovery_credentials');
  const claim = edge.indexOf('claim_anonymous_recovery_and_device');
  assert.ok(limiter !== -1 && credentialLookup !== -1 && limiter < credentialLookup);
  assert.ok(limiter < claim);
});
