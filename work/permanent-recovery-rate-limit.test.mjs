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

test("durable limiter enforces five attempts per fifteen minutes and a thirty minute lockout", () => {
  assert.match(migration, /check_anonymous_recovery_rate_limit/i);
  assert.match(migration, /INTERVAL '15 minutes'/i);
  assert.match(migration, />=\s*5/i);
  assert.match(migration, /INTERVAL '30 minutes'/i);
  assert.match(migration, /RECOVERY_RATE_LIMITED/i);
});

test("preview and claim both call the durable limiter before credential lookup or claim", () => {
  assert.match(edge, /check_anonymous_recovery_rate_limit/);
  const limiter = edge.indexOf('check_anonymous_recovery_rate_limit');
  const credentialLookup = edge.indexOf('anonymous_recovery_credentials');
  const claim = edge.indexOf('claim_anonymous_recovery_and_device');
  assert.ok(limiter !== -1 && credentialLookup !== -1 && limiter < credentialLookup);
  assert.ok(limiter < claim);
});
