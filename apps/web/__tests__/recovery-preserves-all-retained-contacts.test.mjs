import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261019223000_recovery_preserve_all_retained_contacts.sql", import.meta.url),
  "utf8"
);

test("manual recovery moves all active retained contacts from the old identity", () => {
  assert.match(migration, /update public\.anonymous_contacts/i);
  assert.match(migration, /where status\s*=\s*'active'/i);
  assert.match(migration, /user_a\s*=\s*v_old\s+or\s+user_b\s*=\s*v_old/i);
  assert.match(migration, /least\(/i);
  assert.match(migration, /greatest\(/i);
});

test("manual recovery refuses duplicate retained-contact pairs instead of overwriting", () => {
  assert.match(migration, /anonymous_contacts[\s\S]*v_req\.requester_user_id/i);
  assert.match(migration, /raise exception[^;]*重複聯絡人/i);
});
