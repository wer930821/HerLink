import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./realtime-diagnostics.ts", import.meta.url), "utf8");

// Normal message delivery/load and normal connection startup are extremely
// frequent. Only anomalies and meaningful recovery events should hit Supabase.
assert.match(source, /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS/);
for (const eventType of [
  "message_received_realtime",
  "message_loaded_from_db",
  "realtime_subscribe_started",
  "realtime_subscribed",
]) {
  assert.match(
    source,
    new RegExp(`\\"${eventType}\\"`),
    `${eventType} should be explicitly classified as non-persisted`
  );
}
assert.match(source, /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS\.has\(input\.eventType\)/);
assert.doesNotMatch(
  source,
  /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS[\s\S]*?"realtime_subscribe_error"/,
  "realtime errors must remain persisted"
);

console.log("realtime diagnostics contract OK");
