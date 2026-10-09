import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx", import.meta.url), "utf8");

// Healthy Realtime must suppress the 60s database fallback. The timer may stay
// armed so a later channel failure automatically restores fallback polling.
assert.match(source, /const realtimeHealthyRef = useRef\(false\)/);
assert.match(source, /if \(!realtimeHealthyRef\.current\) \{\s*syncNow\(\);\s*\}/);
assert.match(source, /status === "SUBSCRIBED"[\s\S]{0,300}realtimeHealthyRef\.current = true/);
assert.match(source, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"[\s\S]{0,300}realtimeHealthyRef\.current = false/);
assert.match(source, /status === "CLOSED"[\s\S]{0,300}realtimeHealthyRef\.current = false/);

console.log("realtime fallback polling contract OK");
