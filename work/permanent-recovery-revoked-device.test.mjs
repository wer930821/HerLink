import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/migrations/20261006180000_recovered_chat_identity_access.sql", import.meta.url), "utf8");

const expectResolvedActor = (functionName) => {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + marker.length);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(body, /resolve_active_anonymous_chat_identity\(\)/, `${functionName} must resolve the stable anonymous identity`);
  assert.match(body, /actor_id\s+UUID\s*:=\s*public\.resolve_active_anonymous_chat_identity\(\)/i, `${functionName} must use the resolved identity as actor`);
  assert.match(body, /actor_id\s+IS\s+NULL/i, `${functionName} must reject a revoked device`);
};

test("matching and queue actions reject revoked devices and preserve recovered identity", () => {
  expectResolvedActor("find_or_join_random_match");
  expectResolvedActor("leave_random_queue");
  expectResolvedActor("leave_random_session");
  expectResolvedActor("next_random_match");
});

test("block and report actions reject revoked devices and preserve recovered identity", () => {
  expectResolvedActor("block_user");
  expectResolvedActor("block_random_user");
  expectResolvedActor("report_random_user");
});

test("queue and session select policies resolve the active recovered identity", () => {
  assert.match(source, /CREATE POLICY random_match_queue_select_own[\s\S]*?resolve_active_anonymous_chat_identity\(\)/i);
  assert.match(source, /CREATE POLICY random_chat_sessions_select_own[\s\S]*?resolve_active_anonymous_chat_identity\(\)/i);
});
