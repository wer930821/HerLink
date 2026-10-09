import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");

// Realtime/focus/reconnect can request the same session view almost together.
// Coalesce concurrent calls only; do not serve stale cached session state.
assert.match(source, /const randomSessionInFlight = new Map/);
assert.match(source, /const inFlight = randomSessionInFlight\.get\(sessionId\)/);
assert.match(source, /if \(inFlight\) return inFlight;/);
assert.match(source, /randomSessionInFlight\.set\(sessionId, request\)/);
assert.match(source, /randomSessionInFlight\.delete\(sessionId\)/);
assert.doesNotMatch(source, /RANDOM_SESSION_CACHE_TTL_MS/);

console.log("session refresh contract OK");
