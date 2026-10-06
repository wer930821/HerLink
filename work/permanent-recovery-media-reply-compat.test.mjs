import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/migrations/20261006183000_recovered_chat_media_reply_access.sql", import.meta.url), "utf8");

function body(name) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("message listing keeps current cursor, media and reply contract", () => {
  const fn = body("list_random_messages");
  assert.match(fn, /p_before_created_at TIMESTAMPTZ DEFAULT NULL/i);
  assert.match(fn, /p_after_created_at TIMESTAMPTZ DEFAULT NULL/i);
  for (const field of ["message_type", "media_path", "media_mime", "media_size", "media_width", "media_height", "reply_to_message_id", "reply_message_id", "reply_is_mine", "reply_message_type", "reply_body", "reply_media_path"]) assert.match(fn, new RegExp(field, "i"));
  assert.match(fn, /resolve_active_anonymous_chat_identity\(\)/i);
});

test("send keeps image validation, reply validation and recovered stable identity", () => {
  const fn = body("send_random_message");
  assert.match(fn, /p_message_type TEXT DEFAULT 'text'/i);
  assert.match(fn, /p_reply_to_message_id UUID DEFAULT NULL/i);
  assert.match(fn, /resolve_active_anonymous_chat_identity\(\)/i);
  assert.match(fn, /send_image_message_daily/i);
  assert.match(fn, /image\/jpeg/i);
  assert.match(fn, /5242880/i);
  assert.match(fn, /chat_media_path_session_id/i);
  assert.match(fn, /storage\.objects/i);
  assert.match(fn, /Reply target is not available/i);
  assert.match(fn, /repeated_message/i);
  assert.match(fn, /fraud_risk_events/i);
});

test("targeted reply preview uses recovered stable identity", () => {
  const fn = body("get_random_message_reply_preview");
  assert.match(fn, /resolve_active_anonymous_chat_identity\(\)/i);
  assert.match(fn, /reply_message_type/i);
  assert.match(fn, /reply_media_path/i);
});

test("final media migration removes obsolete two-argument chat RPC overloads", () => {
  assert.match(source, /DROP FUNCTION IF EXISTS public\.list_random_messages\(UUID,\s*INTEGER\);/i);
  assert.match(source, /DROP FUNCTION IF EXISTS public\.send_random_message\(UUID,\s*TEXT\);/i);
  assert.equal((source.match(/CREATE OR REPLACE FUNCTION public\.list_random_messages\(/gi) ?? []).length, 1);
  assert.equal((source.match(/CREATE OR REPLACE FUNCTION public\.send_random_message\(/gi) ?? []).length, 1);
});
