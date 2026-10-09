import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../app/waiting/page.tsx", import.meta.url), "utf8");

assert.match(source, /WAITING_FALLBACK_POLL_MS\s*=\s*60_000/, "waiting fallback polling should be reduced to 60 seconds");
assert.match(source, /waitingRealtimeHealthyRef/, "waiting page should track realtime health");
assert.match(source, /postgres_changes/, "waiting page should subscribe to realtime database changes");
assert.match(source, /random_match_queue/, "waiting page should react to queue changes");
assert.match(source, /random_chat_sessions/, "waiting page should react to session changes");
assert.match(source, /status === "SUBSCRIBED"/, "waiting page should mark realtime healthy after subscription");
assert.match(source, /!waitingRealtimeHealthyRef\.current/, "fallback polling should only query while realtime is unhealthy");
assert.doesNotMatch(source, /setInterval\(\(\) => void syncMatchState\(\), 5_000\)/, "waiting page must not poll queue and session every five seconds");

console.log("waiting realtime contract OK");
