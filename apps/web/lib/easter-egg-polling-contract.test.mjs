import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx", import.meta.url), "utf8");

assert.match(source, /event:\s*"easter-egg"/);
assert.match(source, /\.on\("broadcast",\s*\{ event: "easter-egg" \}/);
assert.match(source, /syncPendingEasterEggRef/);
assert.match(source, /if \(!realtimeHealthyRef\.current\)\s*\{\s*void syncPendingEasterEgg\(\);\s*\}/);
assert.doesNotMatch(source, /window\.setInterval\(\(\) => void syncPendingEasterEgg\(\), EASTER_EGG_FALLBACK_POLL_MS\)/);

console.log("easter egg polling contract OK");
