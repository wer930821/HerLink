import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261008160000_fix_recovered_anonymous_contacts_identity.sql", import.meta.url),
  "utf8"
);

test("retained anonymous contact RPCs use the recovered stable identity", () => {
  const expectedFunctions = [
    "request_anonymous_contact",
    "get_anonymous_contact_status",
    "list_my_anonymous_contacts",
    "remove_anonymous_contact",
    "start_anonymous_contact_session",
  ];

  for (const functionName of expectedFunctions) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${functionName}`));
  }

  const stableIdentityCalls = migration.match(/resolve_active_anonymous_chat_identity\(\)/g) ?? [];
  assert.ok(stableIdentityCalls.length >= expectedFunctions.length);
  assert.match(migration, /r\.user_id = actor\.id/);
  assert.match(migration, /m\.sender_id <> actor\.id/);
  assert.match(migration, /Retained contacts are persistent conversations/);
});
