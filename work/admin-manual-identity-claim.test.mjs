import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20261021233000_admin_manual_identity_claim.sql";
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
const mailbox = fs.readFileSync("apps/web/app/admin/mailbox/page.tsx", "utf8");

test("manual identity claim exposes a read-only admin preflight with ownership counts", () => {
  assert.match(migration, /station_mail_admin_manual_identity_preflight/);
  assert.match(migration, /anonymous_display_name/);
  assert.match(migration, /random_chat_sessions/);
  assert.match(migration, /random_chat_messages/);
  assert.match(migration, /anonymous_contacts/);
  assert.match(migration, /AUTH_USER_ALREADY_BOUND/);
});

test("manual identity claim uses the selected mail sender auth user and requires confirmation", () => {
  assert.match(mailbox, /station_mail_admin_manual_identity_preflight/);
  assert.match(mailbox, /station_mail_admin_manual_identity_claim/);
  assert.match(mailbox, /user_id/);
  assert.match(mailbox, /確認接回/);
});

test("manual identity claim never updates chat or contact tables directly", () => {
  assert.doesNotMatch(migration, /update\s+(?:public\.)?(?:random_chat_sessions|random_chat_messages|anonymous_contacts)\s+set/i);
  assert.match(migration, /claim_anonymous_identity_device/);
});
