import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("./realtime-presence.ts", import.meta.url), "utf8");

assert.match(source, /const ONLINE_HEARTBEAT_MS = 60_000;/, "heartbeat should be reduced to once per minute");
assert.match(source, /const ONLINE_COUNT_REFRESH_MS = 120_000;/, "online count should refresh less often than heartbeat");
assert.match(source, /const ONLINE_RESUME_DEDUPE_MS = 5_000;/, "resume refreshes should be deduped");
assert.match(source, /lastHeartbeatRef/, "heartbeat should track its last successful attempt");
assert.match(source, /lastCountRefreshRef/, "count refresh should track its last successful attempt");
assert.match(source, /Date\.now\(\) - lastHeartbeatRef\.current < ONLINE_RESUME_DEDUPE_MS/, "resume should avoid duplicate heartbeat RPCs");
assert.match(source, /Date\.now\(\) - lastCountRefreshRef\.current < ONLINE_COUNT_REFRESH_MS/, "online count should not be fetched on every heartbeat");
assert.doesNotMatch(source, /ONLINE_HEARTBEAT_MS = 30_000/, "30 second polling must be removed");

console.log("online presence polling contract OK");
