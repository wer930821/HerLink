import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../instrumentation-client.ts", import.meta.url), "utf8");

assert.match(source, /get_my_random_session_view/);
assert.match(source, /sessionViewInFlight/);
assert.match(source, /if \(existing\) return existing/);
assert.match(source, /sessionViewInFlight\.delete\(key\)/);
assert.doesNotMatch(source, /setTimeout/);

console.log("session refresh contract OK");
