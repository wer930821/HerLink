import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/chat/SessionReadTracker.tsx", import.meta.url), "utf8");
const contacts = fs.readFileSync(new URL("../app/contacts/page.tsx", import.meta.url), "utf8");

// Do not open a second Realtime subscription only for read receipts.
assert.doesNotMatch(source, /\.channel\(/);
assert.doesNotMatch(source, /postgres_changes/);
assert.doesNotMatch(source, /supabase\.removeChannel/);

// Opening the room and returning to the foreground still mark it read.
assert.match(source, /void markVisibleSessionRead\(\)/);
assert.match(source, /visibilitychange/);

// Repeated foreground events within a short window must not hit the RPC again.
assert.match(source, /READ_MARK_DEDUPE_MS/);
assert.match(source, /lastMarkedRef/);
assert.match(source, /Date\.now\(\) - lastMarked\.at < READ_MARK_DEDUPE_MS/);

// Contacts navigation must not pre-mark a room that SessionReadTracker marks on mount.
assert.doesNotMatch(contacts, /markRandomSessionRead/);

console.log("session read tracker contract OK");
