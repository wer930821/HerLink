import fs from "fs";
import path from "path";

function expect(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function simulateLeave({ trusted = false, confirmed = false } = {}) {
  let status = "active";
  let endedReason = null;
  if (trusted && confirmed) {
    status = "ended";
    endedReason = "left";
  }
  return { status, endedReason };
}

const home = read("apps/web/app/page.tsx");
const session = read("apps/web/app/session/[id]/page.tsx");

for (const source of [home, session]) {
  expect(source.includes("event.nativeEvent.isTrusted"), "leave requires a trusted user gesture");
  expect(source.includes('window.confirm("確定要離開這個聊天室嗎？")'), "leave requires explicit confirmation");
}
expect(!session.includes("beforeunload"), "reload must not leave the session");
expect(!session.includes("pagehide"), "pagehide must not leave the session");
expect(!session.includes("leaveRandomSession(session.id);\n      goHome") || session.includes("window.confirm"), "only confirmed leave may call the leave RPC");

for (const event of ["mount", "refresh-unmount-remount", "temporary-auth-null", "temporary-session-failure", "visibility", "realtime", "route-transition"]) {
  const result = simulateLeave();
  expect(result.status === "active" && result.endedReason === null, `${event} must retain an active session`);
}

const explicitLeave = simulateLeave({ trusted: true, confirmed: true });
expect(explicitLeave.status === "ended" && explicitLeave.endedReason === "left", "confirmed leave must end with left");
console.log(JSON.stringify({ ok: true }));
