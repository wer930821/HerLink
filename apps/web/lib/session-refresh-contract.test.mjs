import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");

// Session view refreshes can arrive together from Realtime, focus, visibility,
// reconnect and fallback polling. Coalesce those calls instead of multiplying
// get_my_random_session_view traffic.
assert.match(source, /const RANDOM_SESSION_CACHE_TTL_MS = 1_500/);
assert.match(source, /randomSessionInFlight/);
assert.match(source, /randomSessionCache/);
assert.match(source, /if \(cached && Date\.now\(\) - cached\.fetchedAt < RANDOM_SESSION_CACHE_TTL_MS\)/);
assert.match(source, /const inFlight = randomSessionInFlight\.get\(sessionId\)/);

console.log("session refresh contract OK");
