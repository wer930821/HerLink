import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(source, /WAITING_COUNT_POLL_MS\s*=\s*60_000/);
assert.match(source, /WAITING_COUNT_REFRESH_DEDUPE_MS\s*=\s*5_000/);
assert.match(source, /lastWaitingCountRefreshRef/);
assert.match(source, /Date\.now\(\) - lastWaitingCountRefreshRef\.current < WAITING_COUNT_REFRESH_DEDUPE_MS/);
assert.match(source, /window\.setInterval\(\(\) => void refreshWaitingCount\(\), WAITING_COUNT_POLL_MS\)/);
assert.match(source, /refreshWaitingCount\(true\)/);
assert.doesNotMatch(source, /setInterval\(\(\) => void refreshWaitingCount\(\), 15000\)/);

console.log("waiting count polling contract OK");
