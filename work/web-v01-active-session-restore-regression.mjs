import fs from "fs";
import path from "path";

function expect(condition, label) {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

async function restoreSessionWithRetry(loader) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const restoredSession = await loader();
    if (restoredSession) {
      return restoredSession;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return null;
}

const homePage = read("apps/web/app/page.tsx");
const sessionPage = read("apps/web/app/session/[id]/page.tsx");

expect(
  homePage.includes("router.push(`/session/${state.activeSession.id}`)"),
  "homepage continue action should use router.push"
);
expect(
  homePage.includes("router.push(`/session/${state.activeSession?.id}`)"),
  "homepage banner continue button should use router.push"
);
expect(
  sessionPage.includes("for (let attempt = 0; attempt < 3; attempt += 1)"),
  "session bootstrap should retry restore"
);
expect(
  sessionPage.includes("window.setTimeout(resolve, 150 * (attempt + 1))"),
  "session bootstrap should wait between retries"
);

const restored = await restoreSessionWithRetry(async () => {
  if (!globalThis.__restoreAttempts) {
    globalThis.__restoreAttempts = 0;
  }

  globalThis.__restoreAttempts += 1;
  return globalThis.__restoreAttempts === 2 ? { id: "session-123", status: "active" } : null;
});

expect(restored?.id === "session-123", "retry restore should recover an active session");

const missing = await restoreSessionWithRetry(async () => null);
expect(missing === null, "retry restore should still return null when no session exists");

console.log(JSON.stringify({ ok: true }));
