import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/migrations/20261006181000_recovered_chat_safety_access.sql", import.meta.url), "utf8");

function functionBody(name) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("recovered send keeps repeated-message safety detection", () => {
  const body = functionBody("send_random_message");
  assert.match(body, /repeated_message\s+BOOLEAN/i);
  assert.match(body, /created_at\s*>=\s*timezone\('utc'::text,\s*now\(\)\)\s*-\s*INTERVAL '30 seconds'/i);
  assert.match(body, /array_append\([^;]*'repeated_message'/i);
  assert.match(body, /detected_risk_level\s*=\s*'low'[\s\S]*detected_risk_level\s*:=\s*'medium'/i);
});

test("recovered send deduplicates risk types and records non-low fraud events", () => {
  const body = functionBody("send_random_message");
  assert.match(body, /SELECT DISTINCT item/i);
  assert.match(body, /unnest\(detected_risk_types\)/i);
  assert.match(body, /INSERT INTO public\.fraud_risk_events/i);
  assert.match(body, /detected_risk_level\s*<>\s*'low'/i);
});

test("recovered next action keeps the original anti-spam rate limit", () => {
  const identitySource = readFileSync(new URL("../supabase/migrations/20261006180000_recovered_chat_identity_access.sql", import.meta.url), "utf8");
  const marker = "CREATE OR REPLACE FUNCTION public.next_random_match";
  const start = identitySource.indexOf(marker);
  assert.notEqual(start, -1);
  const next = identitySource.indexOf("CREATE OR REPLACE FUNCTION public.", start + marker.length);
  const body = identitySource.slice(start, next === -1 ? identitySource.length : next);
  assert.match(body, /check_random_action_rate_limit\(\s*'next_random_match'\s*,\s*3\s*,\s*INTERVAL '20 seconds'/i);
});
