import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./realtime-diagnostics.ts", import.meta.url), "utf8");

// Normal message delivery/load and normal connection startup are extremely
// frequent. Only anomalies and meaningful recovery events should hit Supabase.
const setMatch = source.match(/const NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS = new Set<RealtimeDiagnosticEventType>\(\[([\s\S]*?)\]\);/);
assert.ok(setMatch, "non-persisted realtime diagnostic set should exist");
const nonPersistedSetSource = setMatch[1];

for (const eventType of [
  "message_received_realtime",
  "message_loaded_from_db",
  "realtime_subscribe_started",
  "realtime_subscribed",
]) {
  assert.match(
    nonPersistedSetSource,
    new RegExp(`"${eventType}"`),
    `${eventType} should be explicitly classified as non-persisted`
  );
}

assert.doesNotMatch(
  nonPersistedSetSource,
  /"realtime_subscribe_error"/,
  "realtime errors must remain persisted"
);
assert.match(source, /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS\.has\(input\.eventType\)/);

console.log("realtime diagnostics contract OK");
