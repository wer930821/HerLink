import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync(new URL("../supabase/migrations/20261006180000_recovered_chat_identity_access.sql",import.meta.url),"utf8");

test("current auth user resolves to the stable recovered chat identity",()=>{
  assert.match(source,/resolve_active_anonymous_chat_identity/);
  assert.match(source,/active_auth_user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(source,/anonymous_identity_id/);
});

test("session membership uses resolved identity instead of replacement auth uuid",()=>{
  assert.match(source,/is_active_random_session_member/);
  assert.match(source,/session_row\.user_a\s*=\s*identity_id/i);
  assert.match(source,/session_row\.user_b\s*=\s*identity_id/i);
});

test("message listing and sending authorize through the resolved identity",()=>{
  assert.match(source,/CREATE OR REPLACE FUNCTION public\.list_random_messages/);
  assert.match(source,/CREATE OR REPLACE FUNCTION public\.send_random_message/);
  assert.match(source,/resolve_active_anonymous_chat_identity/);
  assert.match(source,/VALUES\s*\(p_session_id,\s*identity_id,/i);
});

test("realtime select policy accepts only the currently active device for the stable participant identity",()=>{
  assert.match(source,/DROP POLICY IF EXISTS random_chat_messages_select_participant/);
  assert.match(source,/CREATE POLICY random_chat_messages_select_participant/);
  assert.match(source,/resolve_active_anonymous_chat_identity/);
});
