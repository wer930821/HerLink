import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../components/chat/SessionReadTracker.tsx", import.meta.url), "utf8");

// Do not open a second Realtime subscription only for read receipts.
assert.doesNotMatch(source, /\.channel\(/);
assert.doesNotMatch(source, /postgres_changes/);
assert.doesNotMatch(source, /supabase\.removeChannel/);

// Opening the room and returning to the foreground still mark it read.
assert.match(source, /void markVisibleSessionRead\(\)/);
assert.match(source, /visibilitychange/);

console.log("session read tracker contract OK");
