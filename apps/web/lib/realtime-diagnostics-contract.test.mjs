import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./realtime-diagnostics.ts", import.meta.url), "utf8");

// High-volume healthy chat events must stay client-local. Persisting one RPC for
// every delivered/loaded message creates avoidable Database Egress on busy chats.
assert.match(source, /LOCAL_ONLY_REALTIME_DIAGNOSTIC_EVENT_TYPES/);
assert.match(source, /"message_received_realtime"/);
assert.match(source, /"message_loaded_from_db"/);
assert.match(source, /if \(LOCAL_ONLY_REALTIME_DIAGNOSTIC_EVENT_TYPES\.has\(input\.eventType\)\)/);

// Connection lifecycle/error events remain persisted so disconnect/reconnect
// regressions are still diagnosable.
assert.match(source, /supabase\.rpc\("record_realtime_diagnostic"/);

console.log("realtime diagnostics egress contract OK");
