import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx", import.meta.url), "utf8");

// Pending easter eggs must not be polled continuously while Realtime is healthy.
assert.match(source, /const EASTER_EGG_FALLBACK_POLL_MS = 60_000/);
assert.doesNotMatch(source, /setInterval\(syncPendingEasterEgg,\s*2500\)/);

// Database refresh fallback should be low-frequency; Realtime remains the primary sync path.
assert.match(source, /const CHAT_FALLBACK_POLL_MS = 60_000/);
assert.doesNotMatch(source, /setInterval\([^\n]*(?:2500|3000|5000|10000)[^\n]*\)/);

// Keep this contract in the normal web CI after the implementation commit.
console.log("chat polling contract OK");
