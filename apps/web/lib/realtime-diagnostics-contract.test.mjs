import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./realtime-diagnostics.ts", import.meta.url), "utf8");

// Normal message delivery/load events are extremely frequent and must not each
// create another Supabase RPC write. Keep anomaly/lifecycle diagnostics only.
assert.match(source, /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS/);
assert.match(source, /"message_received_realtime"/);
assert.match(source, /"message_loaded_from_db"/);
assert.match(source, /NON_PERSISTED_REALTIME_DIAGNOSTIC_EVENTS\.has\(input\.eventType\)/);

console.log("realtime diagnostics contract OK");
