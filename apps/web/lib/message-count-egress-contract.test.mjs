import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../app/session/[id]/RandomSessionClient.tsx", import.meta.url), "utf8");

const sendStart = source.indexOf("const sendMessage = async () => {");
const sendEnd = source.indexOf("\n  const leave = async", sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart, "sendMessage implementation should exist");
const sendSource = source.slice(sendStart, sendEnd);

assert.doesNotMatch(
  sendSource,
  /getRandomChatMessageCount\(/,
  "sending every message must not issue a separate get_random_chat_message_count RPC"
);
assert.match(
  sendSource,
  /sessionMessageCountRef\.current \+ 1/,
  "successful sends should advance the locally tracked message count"
);
assert.match(
  source,
  /sessionMessageCountRef\.current = messages\.length/,
  "initial loaded history should seed the local message count when the full count is known locally"
);

console.log("message count egress contract OK");
